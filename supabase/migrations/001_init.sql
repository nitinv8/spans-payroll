-- Spans Payroll – initial schema
-- Run in Supabase: SQL Editor → paste → Run (or `supabase db push`).


-- ───────────────────────── Access control ─────────────────────────
-- Only emails listed here can read/write anything, even if someone manages to create an auth account.
create table if not exists app_users (
  email text primary key,
  name text,
  created_at timestamptz not null default now()
);

create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- ───────────────────────── Settings ─────────────────────────
create table if not exists company_settings (
  id int primary key default 1 check (id = 1),
  name text not null default 'Spans Envirotech Pvt. Ltd.',
  address text default '405-406, Woodbury Towers, Charmwood Village, Surajkund Road, Faridabad-121009',
  pan text default 'AAACS9538A',
  cin text default 'U74899DL1993PTC052932',
  slip_notes text default E'Salary will be transferred to your bank account by 7th of the month.\nThis is computer generated and does not need signature.',
  orgzit jsonb not null default '{
    "created_by": "Nitin", "created_by_id": "nverma@spans.co.in",
    "type_of_transaction": "Check Expense",
    "expense_by": "Spans Envirotech Pvt. Ltd. (Check & Reimbursement)", "expense_by_id": "hbn43p3pc8",
    "type_of_expense": "Salary", "gst_input": "Not Applicable", "status": "Claimed",
    "fy_ids": {"FY2026-27": "jkb0g662kp"}
  }'::jsonb,
  updated_at timestamptz not null default now()
);
insert into company_settings (id) values (1) on conflict do nothing;

-- ───────────────────────── Employees ─────────────────────────
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  emp_code text not null unique,            -- "Emp 14"
  name text not null,
  father_name text,
  designation text,
  location text,                             -- "Haryana (Rohtak)", "Karnataka", "Delhi"…
  status text not null default 'Active' check (status in ('Active','Inactive')),
  dob date,
  date_of_joining date,
  date_of_leaving date,
  mobile text,
  email text,
  bank_advice_email text,                    -- email put on the HDFC bulk file (e.g. team@spans.co.in)
  bank_account text,
  ifsc text,
  bank_name text,
  aadhaar text,
  pan text,
  uan text,
  esic_number text,
  blood_group text,
  tshirt_size text,
  shoe_size text,
  tshirt_status text,
  id_card text,
  epf_kyc text,
  orgzit_description text,
  orgzit_id text,
  include_in_bank_file boolean not null default true,
  sort_order int not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Salary history: one row per revision. The row with the latest effective_from <= month end applies.
create table if not exists salary_structures (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  effective_from date not null,
  basic numeric not null default 0,
  hra numeric not null default 0,
  medical numeric not null default 0,
  conveyance numeric not null default 0,
  mobile numeric not null default 0,
  site_allowance numeric not null default 0,
  supervisor_allowance numeric not null default 0,
  overtime numeric not null default 0,
  esi_applicable boolean not null default false,
  pf_applicable boolean not null default false,
  lwf_applicable boolean not null default false,
  bonus_applicable boolean not null default false,
  gratuity_applicable boolean not null default false,
  pt_applicable boolean not null default false,
  extras jsonb not null default '{}'::jsonb,   -- custom fields usable in formulas, e.g. {"food_allowance": 1000}
  remarks text,
  created_at timestamptz not null default now(),
  unique (employee_id, effective_from)
);

-- ───────────────────────── Formulas ─────────────────────────
-- Versioned by effective month. A payroll run copies the applicable set into payroll_runs.formulas.
create table if not exists formula_sets (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  name text not null,
  formulas jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── Payroll ─────────────────────────
create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft','finalized')),
  payment_date date,
  formula_set_id uuid references formula_sets(id) on delete set null,
  formulas jsonb not null,                     -- snapshot used for this month
  notes text,
  finalized_at timestamptz,
  finalized_by text,
  created_at timestamptz not null default now()
);

create table if not exists payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  print_code text,
  snapshot jsonb not null default '{}'::jsonb, -- employee details as at this month (name, bank, UAN…)
  structure_id uuid references salary_structures(id) on delete set null,
  structure jsonb,                             -- structure values used
  working_days numeric not null default 0,
  paid_offs numeric not null default 0,
  leaves numeric not null default 0,
  lop_days numeric not null default 0,
  incentive numeric not null default 0,
  arrears numeric not null default 0,
  ex_gratia numeric not null default 0,
  manual_adjustment numeric not null default 0,
  professional_tax numeric not null default 0,
  remarks text,
  calc jsonb not null default '{}'::jsonb,     -- every computed value, keyed by formula key
  gross numeric,
  net_pay numeric,
  ctc numeric,
  error text,
  updated_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index if not exists payroll_lines_employee on payroll_lines(employee_id);

-- Finalized months are locked at the database level
create or replace function lock_finalized_lines() returns trigger language plpgsql as $$
declare s text;
begin
  select status into s from payroll_runs where id = coalesce(new.run_id, old.run_id);
  if s = 'finalized' then
    raise exception 'This payroll month is finalized. Reopen it before making changes.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_lock_lines on payroll_lines;
create trigger trg_lock_lines before insert or update or delete on payroll_lines
  for each row execute function lock_finalized_lines();

-- ───────────────────────── OT incentives & bonus ─────────────────────────
create table if not exists ot_incentives (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  employee_id uuid not null references employees(id) on delete cascade,
  site text,
  days numeric not null default 0,
  amount numeric,
  remarks text,
  created_at timestamptz not null default now()
);

create table if not exists bonus_payments (
  id uuid primary key default gen_random_uuid(),
  fy text not null,                    -- FY2026-27
  period text not null,                -- "Apr–Sep" / "Oct–Mar"
  employee_id uuid not null references employees(id) on delete cascade,
  amount numeric not null default 0,
  transferred_on date,
  remarks text,
  created_at timestamptz not null default now()
);

-- ───────────────────────── RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['app_users','company_settings','employees','salary_structures','formula_sets',
                           'payroll_runs','payroll_lines','ot_incentives','bonus_payments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists allowed_all on %I', t);
    execute format('create policy allowed_all on %I for all to authenticated using (is_allowed()) with check (is_allowed())', t);
  end loop;
end $$;

-- updated_at helpers
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_touch_emp on employees;
create trigger trg_touch_emp before update on employees for each row execute function touch_updated_at();
drop trigger if exists trg_touch_formula on formula_sets;
create trigger trg_touch_formula before update on formula_sets for each row execute function touch_updated_at();
