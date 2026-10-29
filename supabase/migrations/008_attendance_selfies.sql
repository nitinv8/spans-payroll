-- Private storage for attendance selfies: <employee_id>/<yyyy-mm-dd>-<in|out>-<time>.jpg
-- Employees can only upload into (and view) their own folder; HR (allowed users) can view and delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance', 'attendance', false, 400000, array['image/jpeg'])
on conflict (id) do nothing;

create policy attendance_selfie_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance' and (storage.foldername(name))[1] = my_employee_id()::text);
create policy attendance_selfie_read on storage.objects for select to authenticated
  using (bucket_id = 'attendance' and (is_allowed() or (storage.foldername(name))[1] = my_employee_id()::text));
create policy attendance_selfie_hr_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attendance' and is_allowed());
