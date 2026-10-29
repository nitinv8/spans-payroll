// Re-computes every month processed in the Google Sheet and compares in-hand salary to the rupee.
import { suggestDays } from "../lib/attendance";
import { DEFAULT_FORMULAS, SHEET_FORMULAS_FY26, calculate, validateFormulas, suggestOtIncentive } from "../lib/payroll";
import { parse, evalNode } from "../lib/formula";
import { EMPLOYEES, STRUCTURES, HISTORY, CTC_CHECKS } from "../data/sheet-import";
import { toStructure } from "../data/to-structure";
import { eligibleForMonth } from "../lib/run-logic";

let fail = 0, pass = 0;
const check = (name: string, got: number, want: number, tol = 0.5) => {
  if (Math.abs(got - want) <= tol) pass++;
  else { fail++; console.log(`✗ ${name}: got ${got}, sheet ${want}`); }
};

const errs = [...validateFormulas(SHEET_FORMULAS_FY26), ...validateFormulas(DEFAULT_FORMULAS)];
if (errs.length) { console.log("Formula validation errors:", errs); process.exit(1); }

const emp = (code: string) => EMPLOYEES.find((e) => e.code === code)!;
const run = (month: string, code: string, w: number, o: number, l: number, inc: number, man: number) =>
  calculate(SHEET_FORMULAS_FY26, toStructure(STRUCTURES[code]), {
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
const lop = calculate(SHEET_FORMULAS_FY26, toStructure(STRUCTURES["Emp 14"]), {
  month: "2026-09-01", working_days: 23, paid_offs: 4, leaves: 3, lop_days: 3, incentive: 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0,
}, { location: "Haryana (Rohtak)", designation: "", date_of_joining: null });
check("LOP gross", lop.gross, 20501 * 27 / 30, 0.05);

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

// ── October 2026 defaults ──
const oct = (code: string, over: Partial<Record<string, number>> = {}, month = "2026-10-01", state?: string, sOver: Partial<ReturnType<typeof toStructure>> = {}) =>
  calculate(DEFAULT_FORMULAS, { ...toStructure(STRUCTURES[code]), ...sOver }, {
    month, working_days: 27, paid_offs: 4, leaves: 0, lop_days: 0, incentive: 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0, ...over,
  }, { location: emp(code).location, designation: emp(code).designation, date_of_joining: null, state: state ?? null });
// Joiner on 16 Nov (30-day month): 15 days not employed → half pay, never ₹0
const joiner = oct("Emp 37", { working_days: 13, paid_offs: 2, lop_days: 15 }, "2026-11-01");
check("joiner half gross", joiner.gross, 16781 / 2, 0.01);
check("joiner pay > 0", joiner.net_pay > 0 ? 1 : 0, 1, 0);
check("LOP > days clamps to 0", oct("Emp 37", { lop_days: 40 }).gross, 0, 0);
// PF and EPS at ₹25,000 ceiling: all-basic ₹16,781 operator → 12% = 2014; employer = EPS 1398 + EPF 616 + EDLI 84 + admin 84
const op = oct("Emp 37");
check("PF ee 25k ceiling", op.pf_employee, 2014, 0);
check("EPS on full 16,781", op.eps, 1398, 0);
check("PF er total", op.pf_employer, 1398 + 616 + 84 + 84, 0);
// Above the ceiling (basic 30,000): EPS 2083 + EPF 917 + EDLI 125 + admin 125 = 3250
const hi = oct("Emp 37", {}, "2026-10-01", undefined, { basic: 30000 });
check("EPS capped at 25k", hi.eps, 2083, 0);
check("EPF er at 25k", hi.epf_employer, 917, 0);
check("PF er at 25k = 3250", hi.pf_employer, 3250, 0);
// Old-ceiling equivalence: wage 15,000 gives the familiar 1800 / 1950
check("PF er at 15k = 1950", oct("Emp 37", {}, "2026-10-01", undefined, { basic: 15000 }).pf_employer, 1950, 0);
// Karnataka PT: Mukund (33,200 gross) 200; 300 in Feb; Khem (22,951) nil
check("KA PT Oct", oct("Emp 46").professional_tax, 200, 0);
check("KA PT Feb", oct("Emp 46", {}, "2027-02-01").professional_tax, 300, 0);
check("KA PT below threshold", oct("Emp 43").professional_tax, 0, 0);
check("Haryana no PT", oct("Emp 14").professional_tax, 0, 0);
// Haryana LWF (flag on): 0.2% capped at 35 / 0.4% capped at 70
const lw = oct("Emp 14", {}, "2026-10-01", undefined, { lwf_applicable: true });
check("HR LWF ee cap 35", lw.lwf_employee, 35, 0);
check("HR LWF er cap 70", lw.lwf_employer, 70, 0);
check("KA LWF Dec", oct("Emp 43", {}, "2026-12-01", undefined, { lwf_applicable: true }).lwf_employee, 50, 0);
check("KA LWF not Oct", oct("Emp 43", {}, "2026-10-01", undefined, { lwf_applicable: true }).lwf_employee, 0, 0);
// Typed deductions reduce in-hand and appear in total deductions; net rounded to rupee
const ded = oct("Emp 14", { advance_recovery: 1000, other_deduction: 250.4 });
check("typed deductions", ded.total_deductions, ded.esi_employee + ded.pf_employee + 1250.4, 0.01);
check("net rounded", ded.net_pay % 1, 0, 0);


// ───────────── Attendance → payroll days ─────────────
{
  // Nov 2026: 30 days, Sundays 1, 8, 15, 22, 29; "today" = 15 Nov
  const rows = [
    ...["02", "03", "04", "05", "06", "07"].map((d) => ({ day: `2026-11-${d}`, in_at: "x", in_on_site: true, hr_status: null })),
    { day: "2026-11-09", in_at: "x", in_on_site: false, hr_status: null },
    { day: "2026-11-10", in_at: null, hr_status: "leave" },
    { day: "2026-11-11", in_at: null, hr_status: "half_day" },
    { day: "2026-11-12", in_at: null, hr_status: "holiday" },
    { day: "2026-11-15", in_at: "x", in_on_site: true, hr_status: null }, // worked a Sunday
  ];
  const s = suggestDays({ date_of_joining: "2024-01-01", date_of_leaving: null }, "2026-11-01", rows, "2026-11-15");
  check("att worked", s.working_days, 6 + 1 + 0.5 + 1 + 13, 0);   // 13 = future weekdays 16–30
  check("att offs", s.paid_offs, 2 + 1 + 2, 0);                  // Sun 1, 8 · holiday 12 · future Sun 22, 29
  check("att leaves", s.leaves, 1, 0);
  check("att lop", s.lop_days, 0.5 + 2, 0);                      // half day · no check-in 13, 14
  check("att total = days", s.working_days + s.paid_offs + s.leaves + s.lop_days, 30, 0);
  check("att away", s.away, 1, 0);
  check("att future", s.future_days, 15, 0);
  const joiner = suggestDays({ date_of_joining: "2026-11-20", date_of_leaving: "2026-11-27" }, "2026-11-01",
    [{ day: "2026-11-20", in_at: "x", hr_status: null }, { day: "2026-11-21", in_at: "x", hr_status: null }], "2026-11-30");
  check("att joiner worked", joiner.working_days, 2, 0);
  check("att joiner offs", joiner.paid_offs, 1, 0);               // Sun 22
  check("att joiner lop", joiner.lop_days, 30 - 3, 0);
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
