// Compact seed for loading through a size-limited SQL channel (e.g. the Supabase MCP connector).
// Writes seed-compact/1-base.sql (users, formulas, employees, structures, OT, runs)
// and seed-compact/2-lines-<month>.sql (payroll lines; snapshot/structure rebuilt in SQL, calc as a value array).
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_FORMULAS } from "../lib/payroll";
import { computeLine, snapshotOf, type Employee } from "../lib/run-logic";
import { EMPLOYEES, STRUCTURES, HISTORY, ORGZIT, EXCLUDE_FROM_BANK_FILE, EMPLOYEE_NOTES, OT_LOG, PAYMENT_DATES } from "../data/sheet-import";
import { toStructure } from "../data/to-structure";
import { parseSheetDate } from "./sheet-date";

const out = process.argv[2] || "seed-compact";
mkdirSync(out, { recursive: true });
const q = (v: unknown) => (v == null || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const blank = (v: string) => (/^(not applicable|not eligible)$/i.test(v.trim()) ? "" : v.trim());
const keys = DEFAULT_FORMULAS.map((f) => f.key);

const base: string[] = [];
base.push(`insert into app_users (email) values ('nverma@spans.co.in'),('nitinv8@gmail.com');`);
base.push(`insert into formula_sets (effective_from, name, formulas, notes) values ('2026-04-01','FY2026-27 (from Google Sheet)',${q(JSON.stringify(DEFAULT_FORMULAS))}::jsonb,'Reproduces the FY2026-27 Salary Sheet formulas');`);

const cols = ["emp_code","name","father_name","designation","location","status","dob","date_of_joining","date_of_leaving","mobile","email","bank_advice_email","bank_account","ifsc","aadhaar","pan","uan","esic_number","blood_group","tshirt_size","shoe_size","tshirt_status","id_card","epf_kyc","orgzit_description","orgzit_id","include_in_bank_file","sort_order","notes"];
const empRows: Record<string, Employee> = {};
const vals = EMPLOYEES.map((e, i) => {
  const r: Record<string, unknown> = {
    emp_code: e.code, name: e.name, father_name: e.father_name, designation: e.designation, location: e.location, status: e.status,
    dob: parseSheetDate(e.dob), date_of_joining: parseSheetDate(e.doj), date_of_leaving: parseSheetDate(e.dol), mobile: e.mobile, email: e.email,
    bank_advice_email: ["Emp 1", "Emp 2", "Emp 3"].includes(e.code) ? e.email : "team@spans.co.in",
    bank_account: e.bank_account.replace(/\s/g, ""), ifsc: e.ifsc.trim().toUpperCase(), aadhaar: e.aadhaar, pan: e.pan,
    uan: blank(e.uan), esic_number: blank(e.esic_number), blood_group: e.blood_group, tshirt_size: e.tshirt_size, shoe_size: e.shoe_size,
    tshirt_status: e.tshirt_status, id_card: e.id_card, epf_kyc: e.epf_kyc, orgzit_description: ORGZIT[e.code]?.[0] ?? null,
    orgzit_id: ORGZIT[e.code]?.[1] ?? null, include_in_bank_file: !EXCLUDE_FROM_BANK_FILE.includes(e.code), sort_order: (i + 1) * 10,
    notes: [EMPLOYEE_NOTES[e.code], e.code === "Emp 47" ? "Orgzit ID in the sheet was Mohit's (maobf7eev9) - please verify." : null,
      !STRUCTURES[e.code] ? "No salary structure in the sheet - add one before running payroll." : null].filter(Boolean).join(" ") || null,
  };
  empRows[e.code] = { id: "", ...r, bank_name: null } as unknown as Employee;
  return `(${cols.map((c) => (typeof r[c] === "boolean" || typeof r[c] === "number" ? String(r[c]) : q(r[c]))).join(",")})`;
});
base.push(`insert into employees (${cols.join(",")}) values\n${vals.join(",\n")};`);

base.push(`insert into salary_structures (employee_id,effective_from,basic,hra,conveyance,site_allowance,supervisor_allowance,esi_applicable,pf_applicable,lwf_applicable,bonus_applicable,gratuity_applicable,pt_applicable,remarks)
select e.id,'2026-04-01',v.b,v.h,v.c,v.s,v.sv,v.esi,v.pf,v.lwf,v.bon,v.gr,v.pt,'Imported from Salary Master Data' from (values\n${
  Object.entries(STRUCTURES).map(([code, s]) => { const t = toStructure(s);
    return `(${q(code)},${t.basic},${t.hra},${t.conveyance},${t.site_allowance},${t.supervisor_allowance},${t.esi_applicable},${t.pf_applicable},${t.lwf_applicable},${t.bonus_applicable},${t.gratuity_applicable},${t.pt_applicable})`; }).join(",\n")
}) v(code,b,h,c,s,sv,esi,pf,lwf,bon,gr,pt) join employees e on e.emp_code=v.code;`);

base.push(`insert into ot_incentives (month,employee_id,site,days,amount,remarks) select v.m::date,e.id,v.site,v.d,v.a,v.r from (values\n${
  OT_LOG.map(([m, code, site, d, a, r]) => `(${q(m)},${q(code)},${q(site)},${d},${a ?? "null"}::numeric,${q(r)})`).join(",\n")
}) v(m,code,site,d,a,r) join employees e on e.emp_code=v.code;`);

base.push(`insert into payroll_runs (month,status,payment_date,formula_set_id,formulas,notes) select v.m::date,'draft',v.p::date,f.id,f.formulas,'Imported from Google Sheet' from (values ${
  Object.keys(HISTORY).map((m) => `(${q(m)},${q(PAYMENT_DATES[m] ?? null)})`).join(",")
}) v(m,p), formula_sets f where f.effective_from='2026-04-01';`);
writeFileSync(`${out}/1-base.sql`, base.join("\n\n") + "\n");

// Lines: one file covering all months; snapshot & structure rebuilt from tables, calc from value arrays
const lineVals: string[] = [];
for (const [month, rows] of Object.entries(HISTORY)) rows.forEach(([code, w, o, l, inc, man], i) => {
  const r = computeLine(DEFAULT_FORMULAS, month, snapshotOf(empRows[code]), toStructure(STRUCTURES[code]), {
    working_days: w, paid_offs: o, leaves: l, lop_days: 0, incentive: inc, arrears: 0, ex_gratia: 0, manual_adjustment: man, professional_tax: 0 });
  const c = r.calc as Record<string, number>;
  lineVals.push(`('${month}','${code}','C${i + 1}',${w},${o},${l},${inc},${man},'{${keys.map((k) => c[k]).join(",")}}')`);
});
const keyArr = `'{${keys.join(",")}}'::text[]`;
const lines = `with v(m,code,pc,w,o,l,inc,man,cv) as (values\n${lineVals.join(",\n")})
insert into payroll_lines (run_id,employee_id,print_code,snapshot,structure_id,structure,working_days,paid_offs,leaves,incentive,manual_adjustment,calc,gross,net_pay,ctc)
select r.id, e.id, v.pc,
 jsonb_build_object('name',e.name,'father_name',e.father_name,'emp_code',e.emp_code,'designation',e.designation,'location',e.location,'status',e.status,
   'date_of_joining',e.date_of_joining,'date_of_leaving',e.date_of_leaving,'uan',e.uan,'esic_number',e.esic_number,'bank_account',e.bank_account,'ifsc',e.ifsc,
   'bank_name',e.bank_name,'email',e.email,'bank_advice_email',e.bank_advice_email,'orgzit_description',e.orgzit_description,'orgzit_id',e.orgzit_id,
   'include_in_bank_file',e.include_in_bank_file),
 s.id,
 jsonb_build_object('basic',s.basic,'hra',s.hra,'medical',s.medical,'conveyance',s.conveyance,'mobile',s.mobile,'site_allowance',s.site_allowance,
   'supervisor_allowance',s.supervisor_allowance,'overtime',s.overtime,'esi_applicable',s.esi_applicable,'pf_applicable',s.pf_applicable,
   'lwf_applicable',s.lwf_applicable,'bonus_applicable',s.bonus_applicable,'gratuity_applicable',s.gratuity_applicable,'pt_applicable',s.pt_applicable,'extras',s.extras),
 v.w,v.o,v.l,v.inc,v.man,
 c.calc, (c.calc->>'gross')::numeric, (c.calc->>'net_pay')::numeric, (c.calc->>'ctc')::numeric
from v
join payroll_runs r on r.month=v.m::date
join employees e on e.emp_code=v.code
join salary_structures s on s.employee_id=e.id and s.effective_from='2026-04-01'
cross join lateral (select jsonb_object_agg(k, x) calc from unnest(${keyArr}, v.cv::numeric[]) u(k,x)) c;
update payroll_runs set status='finalized', finalized_at=now(), finalized_by='import';`;
writeFileSync(`${out}/2-lines.sql`, lines + "\n");
console.log("ok", lineVals.length, "lines");
