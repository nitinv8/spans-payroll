-- Slip notes: drop the "transferred by 7th" line (company_settings default and current value)
alter table company_settings alter column slip_notes set default 'This is computer generated and does not need signature.';
update company_settings
set slip_notes = nullif(trim(both E'\n' from replace(slip_notes, 'Salary will be transferred to your bank account by 7th of the month.', '')), '')
where slip_notes like '%7th of the month%';

-- EPS wage ceiling ₹25,000 from 17 Sep 2026 (EPFO FAQs; S.O. 5109(E)) in the October 2026 formula version
update formula_sets
set formulas = (
  select jsonb_agg(case when f->>'key' = 'eps_wage_ceiling' then jsonb_set(f, '{expr}', '"25000"') else f end order by i)
  from jsonb_array_elements(formulas) with ordinality as t(f, i))
where effective_from = '2026-10-01';
