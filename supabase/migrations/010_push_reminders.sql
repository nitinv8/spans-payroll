-- Push reminders to the staff app (web push).
-- push_subscriptions: one row per phone/browser that turned reminders on. Staff add/remove their own through
-- SECURITY DEFINER functions; HR (is_allowed) can read; the server sends with the service key.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_error text
);
create index if not exists push_subscriptions_employee on push_subscriptions(employee_id);
alter table push_subscriptions enable row level security;
create policy push_hr_read on push_subscriptions for select using (is_allowed());

-- the check-out reminder is sent once per shift
alter table attendance add column if not exists checkout_reminded_at timestamptz;

create or replace function my_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := my_employee_id();
begin
  if me is null then raise exception 'Not signed in as an employee.'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'This phone did not give a valid notification address.';
  end if;
  insert into push_subscriptions (employee_id, endpoint, p256dh, auth, device)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_device, 200))
  on conflict (endpoint) do update set employee_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
    device = excluded.device, created_at = now(), last_error = null;
end $$;

create or replace function my_push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  update push_subscriptions set last_error = 'turned off by employee', endpoint = 'off:' || id::text
  where endpoint = p_endpoint and employee_id = my_employee_id();
$$;

-- does this phone (endpoint) have reminders on for me?
create or replace function my_push_status(p_endpoint text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from push_subscriptions where endpoint = p_endpoint and employee_id = my_employee_id());
$$;

revoke execute on function my_push_subscribe(text, text, text, text) from public, anon;
revoke execute on function my_push_unsubscribe(text) from public, anon;
revoke execute on function my_push_status(text) from public, anon;
grant execute on function my_push_subscribe(text, text, text, text) to authenticated;
grant execute on function my_push_unsubscribe(text) to authenticated;
grant execute on function my_push_status(text) to authenticated;
