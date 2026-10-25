-- Controls & audit: audit trail, export log, stronger locks, MFA enforcement in the database

-- ───────────── Audit trail (append-only) ─────────────
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,                      -- email from the login token
  table_name text not null,
  row_id text,
  action text not null,            -- INSERT / UPDATE / DELETE / REVEAL / EXPORT
  old jsonb,
  new jsonb
);
create index if not exists audit_log_at on audit_log (at desc);
create index if not exists audit_log_row on audit_log (table_name, row_id);

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  -- skip no-op updates
  if tg_op = 'UPDATE' and o - 'updated_at' = n - 'updated_at' then return new; end if;
  insert into audit_log (actor, table_name, row_id, action, old, new)
  values (coalesce(auth.jwt() ->> 'email', current_user), tg_table_name,
          coalesce(n ->> 'id', o ->> 'id', n ->> 'email', o ->> 'email'), tg_op, o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['employees','salary_structures','formula_sets','payroll_runs','payroll_lines',
                           'ot_incentives','bonus_payments','app_users','company_settings']
  loop
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_trigger()', t);
  end loop;
end $$;

alter table audit_log enable row level security;
create policy audit_read on audit_log for select to authenticated using (is_allowed());
-- app may add REVEAL / EXPORT entries; nobody can edit or delete entries
create policy audit_add on audit_log for insert to authenticated
  with check (is_allowed() and action in ('REVEAL', 'EXPORT') and actor = auth.jwt() ->> 'email');

-- ───────────── Export log (bank / accounting files) ─────────────
create table if not exists export_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  run_id uuid not null references payroll_runs(id) on delete cascade,
  kind text not null,              -- hdfc / orgzit / register / slips
  rows int not null default 0,
  total numeric not null default 0,
  actor text
);
create index if not exists export_log_run on export_log (run_id, at desc);
alter table export_log enable row level security;
create policy allowed_all on export_log for all to authenticated using (is_allowed()) with check (is_allowed());

-- ───────────── Locks for finalized months ─────────────
-- A finalized month can only be reopened; its formulas, payment date and notes are frozen, and it can't be deleted.
create or replace function lock_finalized_run() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalized' then raise exception 'A finalized payroll month cannot be deleted. Reopen it first.'; end if;
    return old;
  end if;
  if old.status = 'finalized' and new.status = 'finalized' then
    raise exception 'This payroll month is finalized. Reopen it before making changes.';
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_run on payroll_runs;
create trigger trg_lock_run before update or delete on payroll_runs for each row execute function lock_finalized_run();

-- OT entries for a finalized month are frozen
create or replace function lock_finalized_ot() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from payroll_runs where status = 'finalized' and month = coalesce(new.month, old.month)) then
    raise exception 'Payroll for this month is finalized. Reopen it before changing its OT entries.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_lock_ot on ot_incentives;
create trigger trg_lock_ot before insert or update or delete on ot_incentives for each row execute function lock_finalized_ot();

-- Formula versions used by a finalized month are read-only (create a new version instead)
create or replace function lock_used_formulas() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from payroll_runs where status = 'finalized' and formula_set_id = old.id)
     and (tg_op = 'DELETE' or new.formulas is distinct from old.formulas or new.effective_from is distinct from old.effective_from) then
    raise exception 'This formula version is used by a finalized month. Create a new version instead.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_lock_formulas on formula_sets;
create trigger trg_lock_formulas before update or delete on formula_sets for each row execute function lock_used_formulas();

-- ───────────── Two-step login enforced by the database ─────────────
-- Once a user has a verified authenticator app, their data access requires a login completed with the code (aal2).
create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
     and (
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
     );
$$;
revoke execute on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- trigger function is never called directly
revoke execute on function public.audit_trigger() from public, anon, authenticated;
