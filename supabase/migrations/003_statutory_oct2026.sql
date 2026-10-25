-- October 2026 statutory update + typed deductions
-- 1) State used for statutory rules (PT / LWF / ESIC returns), separate from the free-text site/location
alter table employees add column if not exists state text;
update employees set state = case
  when location ilike '%haryana%' or location ilike '%rohtak%' or location ilike '%gurugram%' or location ilike '%gurgaon%' or location ilike '%faridabad%' then 'Haryana'
  when location ilike '%karnataka%' or location ilike '%bangalore%' or location ilike '%bengaluru%' then 'Karnataka'
  when location ilike '%delhi%' then 'Delhi'
  else null end
where state is null;

-- 2) Typed deductions on payroll lines
alter table payroll_lines add column if not exists advance_recovery numeric not null default 0;
alter table payroll_lines add column if not exists other_deduction numeric not null default 0;

-- 3) Labour Welfare Fund applies to staff in Haryana (monthly) and Karnataka (December):
--    switch the flag on in each employee's current salary structure (past finalized months keep their own copy)
update salary_structures s set lwf_applicable = true
from employees e
where s.employee_id = e.id and e.state in ('Haryana', 'Karnataka') and s.lwf_applicable = false
  and s.effective_from = (select max(effective_from) from salary_structures x where x.employee_id = s.employee_id);
