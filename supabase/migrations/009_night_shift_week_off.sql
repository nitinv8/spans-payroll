-- Night shifts and weekly offs in the staff app.
-- 1. Check-out closes the latest open shift started in the last 18 hours, even if the date has changed
--    (C shift: in 10 PM, out 6 AM next day). The shift stays on the day it started.
-- 2. Employees can mark their own weekly off (one per Monday–Sunday week), for days from 7 days ago to 14 days ahead.
--    HR marks still win; checking in on a day marked off clears the mark.

alter table attendance add column if not exists self_status text check (self_status in ('week_off'));
alter table attendance add column if not exists self_marked_at timestamptz;

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
  open_shift attendance%rowtype;
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

  if p_kind = 'in' then
    select * into row from attendance where employee_id = me and day = today;
    if row.in_at is not null then raise exception 'You already checked in today at %.', to_char(row.in_at at time zone 'Asia/Kolkata', 'HH12:MI AM'); end if;
    insert into attendance (employee_id, day, in_at, in_lat, in_lng, in_accuracy, in_site_id, in_distance_m, in_on_site, in_photo)
    values (me, today, now(), p_lat, p_lng, p_accuracy, s.id, dist, on_site, p_photo)
    on conflict (employee_id, day) do update set in_at = excluded.in_at, in_lat = excluded.in_lat, in_lng = excluded.in_lng,
      in_accuracy = excluded.in_accuracy, in_site_id = excluded.in_site_id, in_distance_m = excluded.in_distance_m,
      in_on_site = excluded.in_on_site, in_photo = excluded.in_photo, self_status = null, self_marked_at = null, updated_at = now();
  else
    -- the latest shift still open, started within the last 18 hours (today's, or last night's)
    select * into open_shift from attendance
    where employee_id = me and in_at is not null and out_at is null and in_at > now() - interval '18 hours'
    order by in_at desc limit 1;
    if open_shift.id is null then
      select * into row from attendance where employee_id = me and day = today;
      if row.out_at is not null then raise exception 'You already checked out today at %.', to_char(row.out_at at time zone 'Asia/Kolkata', 'HH12:MI AM'); end if;
      raise exception 'Check in first.';
    end if;
    update attendance set out_at = now(), out_lat = p_lat, out_lng = p_lng, out_accuracy = p_accuracy, out_site_id = s.id,
      out_distance_m = dist, out_on_site = on_site, out_photo = p_photo, updated_at = now()
    where id = open_shift.id;
  end if;
  return jsonb_build_object('kind', p_kind, 'at', now(), 'site', s.name, 'distance_m', dist, 'on_site', on_site);
end $$;

-- Mark (p_on = true) or unmark a weekly off for the signed-in employee
create or replace function attendance_week_off(p_day date, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := my_employee_id();
  emp employees%rowtype;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  row attendance%rowtype;
  wk_start date := p_day - (extract(isodow from p_day)::int - 1);
  other date;
begin
  if me is null then raise exception 'Not signed in as an employee.'; end if;
  select * into emp from employees where id = me;
  if emp.status <> 'Active' then raise exception 'Attendance is only for current employees.'; end if;
  if p_day is null or p_day < today - 7 or p_day > today + 14 then
    raise exception 'You can mark a weekly off from 7 days ago up to 14 days ahead. Ask HR for other dates.';
  end if;
  select * into row from attendance where employee_id = me and day = p_day;
  if row.hr_status is not null then raise exception 'HR has already marked this day. Ask HR to change it.'; end if;

  if p_on then
    if row.in_at is not null then raise exception 'You checked in on this day, so it can''t be a weekly off.'; end if;
    select day into other from attendance
    where employee_id = me and self_status = 'week_off' and day between wk_start and wk_start + 6 and day <> p_day limit 1;
    if other is not null then
      raise exception 'You already marked % as your weekly off this week. Remove it first.', to_char(other, 'Dy DD Mon');
    end if;
    insert into attendance (employee_id, day, self_status, self_marked_at) values (me, p_day, 'week_off', now())
    on conflict (employee_id, day) do update set self_status = 'week_off', self_marked_at = now(), updated_at = now();
  else
    update attendance set self_status = null, self_marked_at = null, updated_at = now() where employee_id = me and day = p_day;
  end if;
  return jsonb_build_object('day', p_day, 'week_off', p_on);
end $$;

create or replace function my_attendance(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'day', a.day, 'in_at', a.in_at, 'out_at', a.out_at, 'in_on_site', a.in_on_site, 'out_on_site', a.out_on_site,
      'in_site', si.name, 'out_site', so.name, 'hr_status', a.hr_status, 'hr_note', a.hr_note, 'self_status', a.self_status)
      order by a.day desc), '[]'::jsonb)
  from attendance a left join sites si on si.id = a.in_site_id left join sites so on so.id = a.out_site_id
  where a.employee_id = my_employee_id() and a.day between p_from and p_to;
$$;

revoke execute on function attendance_week_off(date, boolean) from public, anon;
grant execute on function attendance_week_off(date, boolean) to authenticated;
