-- Employee app (/my) and geo-tagged attendance with selfies.
-- Employees sign in with their own Supabase login (mobile + PIN, created by HR). They never read HR tables directly:
-- everything they see comes from the my_* functions below, which only return the signed-in employee's own records.

-- ───────────── Employee login link ─────────────
alter table employees add column if not exists auth_user_id uuid unique;
alter table employees add column if not exists app_access boolean not null default false;
alter table employees add column if not exists privacy_ack_at timestamptz;

-- Employee record for the signed-in employee login (null for HR logins, disabled access, Draft, or left > 12 months ago)
create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select e.id from employees e
  where e.auth_user_id = auth.uid() and e.app_access
    and (e.status = 'Active' or (e.status = 'Inactive' and coalesce(e.date_of_leaving, current_date) > current_date - interval '12 months'))
$$;

-- ───────────── Sites and attendance ─────────────
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m int not null default 300 check (radius_m between 25 and 20000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  day date not null,
  in_at timestamptz, in_lat double precision, in_lng double precision, in_accuracy real,
  in_site_id uuid references sites(id) on delete set null, in_distance_m int, in_on_site boolean, in_photo text,
  out_at timestamptz, out_lat double precision, out_lng double precision, out_accuracy real,
  out_site_id uuid references sites(id) on delete set null, out_distance_m int, out_on_site boolean, out_photo text,
  -- HR marking: a status for the day (overrides what the app recorded) and the reason
  hr_status text check (hr_status in ('present', 'half_day', 'absent', 'leave', 'holiday')),
  hr_note text,
  updated_at timestamptz not null default now(),
  unique (employee_id, day),
  check (hr_status is null or (hr_note is not null and length(trim(hr_note)) > 0))
);
create index if not exists attendance_day on attendance (day);

alter table sites enable row level security;
alter table attendance enable row level security;
create policy allowed_all on sites for all to authenticated using (is_allowed()) with check (is_allowed());
create policy allowed_all on attendance for all to authenticated using (is_allowed()) with check (is_allowed());

create trigger trg_audit after insert or update or delete on sites for each row execute function audit_trigger();
create trigger trg_audit after insert or update or delete on attendance for each row execute function audit_trigger();

-- Distance in metres between two points (haversine)
create or replace function distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- Check in / check out for the signed-in employee. Time is the server's (India time), not the phone's.
create or replace function attendance_punch(p_kind text, p_lat double precision, p_lng double precision, p_accuracy real, p_photo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := my_employee_id();
  emp employees%rowtype;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  s record;
  dist int;
  on_site boolean;
  row attendance%rowtype;
begin
  if me is null then raise exception 'Not signed in as an employee.'; end if;
  select * into emp from employees where id = me;
  if emp.status <> 'Active' then raise exception 'Attendance is only for current employees.'; end if;
  if p_kind not in ('in', 'out') then raise exception 'Unknown action.'; end if;
  if p_lat is null or p_lng is null then raise exception 'Location is needed to mark attendance. Allow location for this site and try again.'; end if;
  if p_photo is null or split_part(p_photo, '/', 1) <> me::text then raise exception 'A selfie is needed to mark attendance.'; end if;

  select id, name, radius_m, distance_m(p_lat, p_lng, lat, lng) d into s
  from sites where active order by distance_m(p_lat, p_lng, lat, lng) limit 1;
  dist := case when s.id is null then null else round(s.d) end;
  -- allow for GPS error (up to 100 m) before calling it "away from site"
  on_site := s.id is not null and s.d - least(coalesce(p_accuracy, 0), 100) <= s.radius_m;

  select * into row from attendance where employee_id = me and day = today;
  if p_kind = 'in' then
    if row.in_at is not null then raise exception 'You already checked in today at %.', to_char(row.in_at at time zone 'Asia/Kolkata', 'HH12:MI AM'); end if;
    insert into attendance (employee_id, day, in_at, in_lat, in_lng, in_accuracy, in_site_id, in_distance_m, in_on_site, in_photo)
    values (me, today, now(), p_lat, p_lng, p_accuracy, s.id, dist, on_site, p_photo)
    on conflict (employee_id, day) do update set in_at = excluded.in_at, in_lat = excluded.in_lat, in_lng = excluded.in_lng,
      in_accuracy = excluded.in_accuracy, in_site_id = excluded.in_site_id, in_distance_m = excluded.in_distance_m,
      in_on_site = excluded.in_on_site, in_photo = excluded.in_photo, updated_at = now();
  else
    if row.in_at is null then raise exception 'Check in first.'; end if;
    if row.out_at is not null then raise exception 'You already checked out today at %.', to_char(row.out_at at time zone 'Asia/Kolkata', 'HH12:MI AM'); end if;
    update attendance set out_at = now(), out_lat = p_lat, out_lng = p_lng, out_accuracy = p_accuracy, out_site_id = s.id,
      out_distance_m = dist, out_on_site = on_site, out_photo = p_photo, updated_at = now()
    where employee_id = me and day = today;
  end if;
  return jsonb_build_object('kind', p_kind, 'at', now(), 'site', s.name, 'distance_m', dist, 'on_site', on_site);
end $$;

-- ───────────── What employees can read (their own records only) ─────────────
create or replace function my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'emp_code', e.emp_code, 'name', e.name, 'father_name', e.father_name, 'designation', e.designation,
    'location', e.location, 'state', e.state, 'status', e.status, 'date_of_joining', e.date_of_joining, 'date_of_leaving', e.date_of_leaving,
    'mobile', e.mobile, 'email', e.email, 'uan', e.uan, 'esic_number', e.esic_number, 'bank_name', e.bank_name, 'ifsc', e.ifsc,
    'bank_last4', right(regexp_replace(coalesce(e.bank_account, ''), '\s', '', 'g'), 4),
    'joining_letter_url', e.joining_letter_url, 'privacy_ack_at', e.privacy_ack_at)
  from employees e where e.id = my_employee_id();
$$;

create or replace function my_ack_privacy() returns void
language sql security definer set search_path = public as $$
  update employees set privacy_ack_at = coalesce(privacy_ack_at, now()) where id = my_employee_id();
$$;

-- Finalized payslips with the PF/ESI figures used for the year-to-date summary
create or replace function my_payslips() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'line_id', l.id, 'month', r.month, 'payment_date', r.payment_date, 'gross', l.gross, 'net_pay', l.net_pay,
      'days', jsonb_build_object('worked', l.working_days, 'offs', l.paid_offs, 'leaves', l.leaves, 'lop', l.lop_days),
      'pf_employee', l.calc -> 'pf_employee', 'pf_employer', l.calc -> 'pf_employer', 'eps', l.calc -> 'eps',
      'epf_employer', l.calc -> 'epf_employer', 'pf_wage', l.calc -> 'pf_wage_capped',
      'esi_employee', l.calc -> 'esi_employee', 'esi_employer', l.calc -> 'esi_employer')
    order by r.month desc), '[]'::jsonb)
  from payroll_lines l join payroll_runs r on r.id = l.run_id
  where l.employee_id = my_employee_id() and r.status = 'finalized';
$$;

-- One finalized payslip with everything needed to print it
create or replace function my_payslip(p_line uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'line', to_jsonb(l) - 'structure' - 'structure_id',
    'run', jsonb_build_object('month', r.month, 'status', r.status, 'payment_date', r.payment_date, 'formulas', r.formulas),
    'company', (select jsonb_build_object('name', c.name, 'address', c.address, 'pan', c.pan, 'cin', c.cin, 'slip_notes', c.slip_notes)
                from company_settings c where c.id = 1))
  from payroll_lines l join payroll_runs r on r.id = l.run_id
  where l.id = p_line and l.employee_id = my_employee_id() and r.status = 'finalized';
$$;

-- Salary revisions and the formula versions needed to show the break-up
create or replace function my_salary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'revisions', coalesce((select jsonb_agg(to_jsonb(s) - 'employee_id' order by s.effective_from desc)
                           from salary_structures s where s.employee_id = my_employee_id()), '[]'::jsonb),
    'formula_sets', case when my_employee_id() is null then '[]'::jsonb else
      coalesce((select jsonb_agg(jsonb_build_object('effective_from', f.effective_from, 'formulas', f.formulas)) from formula_sets f), '[]'::jsonb) end);
$$;

create or replace function my_attendance(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'day', a.day, 'in_at', a.in_at, 'out_at', a.out_at, 'in_on_site', a.in_on_site, 'out_on_site', a.out_on_site,
      'in_site', si.name, 'out_site', so.name, 'hr_status', a.hr_status, 'hr_note', a.hr_note) order by a.day desc), '[]'::jsonb)
  from attendance a left join sites si on si.id = a.in_site_id left join sites so on so.id = a.out_site_id
  where a.employee_id = my_employee_id() and a.day between p_from and p_to;
$$;

revoke execute on function my_employee_id(), attendance_punch(text, double precision, double precision, real, text), my_profile(), my_ack_privacy(),
  my_payslips(), my_payslip(uuid), my_salary(), my_attendance(date, date) from public, anon;
grant execute on function my_employee_id(), attendance_punch(text, double precision, double precision, real, text), my_profile(), my_ack_privacy(),
  my_payslips(), my_payslip(uuid), my_salary(), my_attendance(date, date) to authenticated;

-- ───────────── PIN lockout: 5 wrong PINs for a mobile in 15 minutes → wait 15 minutes ─────────────
create table if not exists employee_login_attempts (
  id bigserial primary key,
  mobile text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists employee_login_attempts_mobile on employee_login_attempts (mobile, at desc);
alter table employee_login_attempts enable row level security;
create policy allowed_read on employee_login_attempts for select to authenticated using (is_allowed());

create or replace function employee_login_allowed(p_mobile text) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) < 5 from employee_login_attempts
  where mobile = p_mobile and not ok and at > now() - interval '15 minutes'
    and at > coalesce((select max(at) from employee_login_attempts where mobile = p_mobile and ok), '-infinity');
$$;

create or replace function employee_login_record(p_mobile text, p_ok boolean) returns void
language sql security definer set search_path = public as $$
  insert into employee_login_attempts (mobile, ok) values (left(p_mobile, 15), p_ok);
$$;
grant execute on function employee_login_allowed(text), employee_login_record(text, boolean) to anon, authenticated;
