-- Draft employees (offer / interview stage: never included in payroll) and joining-letter link
alter table employees add column if not exists joining_letter_url text;
alter table employees drop constraint if exists employees_status_check;
alter table employees add constraint employees_status_check check (status in ('Active', 'Inactive', 'Draft'));
