-- Connected apps (MCP / OAuth): recognise the user from any Supabase token and mark what Claude does in the audit log.

-- Email of the signed-in user. OAuth access tokens may not carry the email claim, so fall back to auth.users.
create or replace function current_email() returns text
language sql stable security definer set search_path = public, auth as $$
  select lower(coalesce(nullif(auth.jwt() ->> 'email', ''), (select u.email from auth.users u where u.id = auth.uid())));
$$;

-- True when the request comes through a connected app (an OAuth token has a client_id claim).
create or replace function via_connected_app() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ? 'client_id', false); $$;

-- Name shown in the audit log
create or replace function current_actor() returns text
language sql stable security definer set search_path = public, auth as $$
  select current_email() || case when via_connected_app() then ' (via connected app)' else '' end;
$$;

create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where lower(email) = current_email())
     and (
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
     );
$$;

-- Audit: who did it (with "via connected app" when it came through Claude)
create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and o - 'updated_at' = n - 'updated_at' then return new; end if;
  insert into audit_log (actor, table_name, row_id, action, old, new)
  values (coalesce(current_actor(), current_user), tg_table_name,
          coalesce(n ->> 'id', o ->> 'id', n ->> 'email', o ->> 'email'), tg_op, o, n);
  return coalesce(new, old);
end $$;
revoke execute on function public.audit_trigger() from public, anon, authenticated;

alter table audit_log alter column actor set default current_actor();
alter policy audit_add on audit_log
  with check (is_allowed() and action in ('REVEAL', 'EXPORT') and actor = current_actor());

alter table export_log alter column actor set default current_actor();

-- Who can log in is managed in the app only, never through a connected app (restrictive policies are AND-ed with allowed_all)
create policy app_users_no_insert_via_app on app_users as restrictive for insert to authenticated with check (not via_connected_app());
create policy app_users_no_update_via_app on app_users as restrictive for update to authenticated using (not via_connected_app());
create policy app_users_no_delete_via_app on app_users as restrictive for delete to authenticated using (not via_connected_app());

revoke execute on function public.current_email() from public, anon;
revoke execute on function public.current_actor() from public, anon;
grant execute on function public.current_email(), public.current_actor(), public.via_connected_app() to authenticated;
