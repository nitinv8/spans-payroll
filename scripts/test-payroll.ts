// Re-computes every month processed in the Google Sheet and compares in-hand salary to the rupee.
import { DEFAULT_FORMULAS, calculate, validateFormulas, suggestOtIncentive } from "../lib/payroll";
import { parse, evalNode } from "../lib/formula";
import { EMPLOYEES, STRUCTURES, HISTORY, CTC_CHECKS } from "../data/sheet-import";
import { toStructure } from "../data/to-structure";
import { eligibleForMonth } from "../lib/run-logic";

let fail = 0, pass = 0;
const check = (name: string, got: number, want: number, tol = 0.5) => {
  if (Math.abs(got - want) <= tol) pass++;
  else { fail++; console.log(`✗ ${name}: got ${got}, sheet ${want}`); }
};

const errs = validateFormulas(DEFAULT_FORMULAS);
if (errs.length) { console.log("Formula validation errors:", errs); process.exit(1); }

const emp = (code: string) => EMPLOYEES.find((e) => e.code === code)!;
const run = (month: string, code: string, w: number, o: number, l: number, inc: number, man: number) =>
  calculate(DEFAULT_FORMULAS, toStructure(STRUCTURES[code]), {
    month, working_days: w, paid_offs: o, leaves: l, lop_days: 0, incentive: inc, arrears: 0, ex_gratia: 0,
    manual_adjustment: man, professional_tax: 0,
  }, { location: emp(code).location, designation: emp(code).designation, date_of_joining: null });

for (const [month, rows] of Object.entries(HISTORY))
  for (const [code, w, o, l, inc, man, net] of rows) check(`${month} ${code} net`, run(month, code, w, o, l, inc, man).net_pay, net);

for (const [month, code, ob, ctc] of CTC_CHECKS) {
  const row = HISTORY[month].find((r) => r[0] === code)!;
  const r = run(month, code, row[1], row[2], row[3], row[4], row[5]);
  check(`${month} ${code} other benefits`, r.other_benefits, ob);
  check(`${month} ${code} CTC`, r.ctc, ctc);
}

// Specific statutory values from the sheet
const sat = run("2026-09-01", "Emp 14", 26, 4, 0, 0, 0);
check("Satish ESI emp", sat.esi_employee, 139, 0); check("Satish ESI er", sat.esi_employer, 602, 0);
check("Satish PF emp", sat.pf_employee, 1800, 0); check("Satish bonus", sat.bonus, 1541.13, 0.01);
const pri = run("2026-08-01", "Emp 37", 26, 4, 1, 1354, 0);
check("Pritam Aug ESI emp", pri.esi_employee, 137, 0); check("Pritam Aug ESI er", pri.esi_employer, 590, 0);

// LOP pro-rating sanity: 3 LOP days of 30 on Satish
const lop = calculate(DEFAULT_FORMULAS, toStructure(STRUCTURES["Emp 14"]), {
  month: "2026-09-01", working_days: 23, paid_offs: 4, leaves: 3, lop_days: 3, incentive: 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0,
}, { location: "Haryana (Rohtak)", designation: "", date_of_joining: null });
check("LOP gross", lop.gross, 20501 * 0.9, 0.05);

// Formula language
const ev = (s: string, ctx = {}) => evalNode(parse(s), ctx);
check("percent", Number(ev("12% * 15000")), 1800, 0);
check("roundup", Number(ev("roundup(138.01)")), 139, 0);
check("if/contains", Number(ev('if(contains(loc, "haryana"), 1, 0)', { loc: "Haryana (Rohtak)" })), 1, 0);
check("ternary", Number(ev("a > 2 ? 10 : 20", { a: 3 })), 10, 0);
for (const bad of ["constructor", "toString", "__proto__", "valueOf(1)", "constructor.prototype"]) {
  let threw = false; try { ev(bad); } catch { threw = true; }
  check(`blocked: ${bad}`, threw ? 1 : 0, 1, 0);
}

// OT suggestion matches OT log (Mohit Aug 2.5 days → 1353; Pritam Jul 3.5 → 1895)
check("OT Mohit", suggestOtIncentive(toStructure(STRUCTURES["Emp 41"]), 31, 2.5, false, false).amount, 1353, 0);
check("OT Pritam", suggestOtIncentive(toStructure(STRUCTURES["Emp 37"]), 31, 3.5, false, false).amount, 1895, 0);

// Draft employees are never on payroll; active ones are; leavers only up to their leaving month
const base = { id: "x", emp_code: "Emp 99", name: "T", father_name: null, designation: null, location: null, date_of_joining: "2026-01-01", date_of_leaving: null,
  uan: null, esic_number: null, bank_account: null, ifsc: null, bank_name: null, email: null, orgzit_description: null, orgzit_id: null, include_in_bank_file: true, sort_order: 1 };
check("draft excluded", eligibleForMonth({ ...base, status: "Draft" }, "2026-10-01") ? 1 : 0, 0, 0);
check("active included", eligibleForMonth({ ...base, status: "Active" }, "2026-10-01") ? 1 : 0, 1, 0);
check("leaver in leaving month", eligibleForMonth({ ...base, status: "Inactive", date_of_leaving: "2026-10-15" }, "2026-10-01") ? 1 : 0, 1, 0);
check("leaver after leaving", eligibleForMonth({ ...base, status: "Inactive", date_of_leaving: "2026-09-15" }, "2026-10-01") ? 1 : 0, 0, 0);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
