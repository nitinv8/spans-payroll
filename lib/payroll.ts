// Payroll engine driven by user-editable formulas (see lib/formula.ts).
// DEFAULT_FORMULAS reproduces the "FY2026-27-Salary Sheet" in the Spans Google Sheet exactly.

import { parse, evalNode, referencedNames, type Ctx } from "./formula";

export type Category = "parameter" | "working" | "earning" | "deduction" | "employer" | "total";

export type FormulaRow = {
  key: string; // variable name, e.g. esi_employee
  label: string; // shown on slips / register
  expr: string; // formula
  category: Category;
  on_slip?: boolean; // earnings/deductions/employer rows only
};

export const CATEGORY_LABEL: Record<Category, string> = {
  parameter: "Rates & limits",
  working: "Working values (hidden)",
  earning: "Earnings (on slip)",
  deduction: "Employee deductions (on slip)",
  employer: "Employer contributions",
  total: "Totals",
};

/** Keys the app relies on for slips, bank file and compliance reports. */
export const REQUIRED_KEYS = [
  "gross", "gross_ex_conveyance", "pf_wage",
  "esi_employee", "esi_employer", "pf_employee", "pf_employer", "lwf_employee", "lwf_employer",
  "bonus", "gratuity", "total_deductions", "other_benefits", "net_pay", "ctc",
] as const;

/** Inputs every formula can use. */
export const INPUT_VARIABLES: { key: string; label: string; group: string }[] = [
  { key: "basic", label: "Basic (structure)", group: "Salary structure" },
  { key: "hra", label: "HRA", group: "Salary structure" },
  { key: "medical", label: "Medical", group: "Salary structure" },
  { key: "conveyance", label: "Conveyance", group: "Salary structure" },
  { key: "mobile", label: "Mobile", group: "Salary structure" },
  { key: "site_allowance", label: "Site allowance", group: "Salary structure" },
  { key: "supervisor_allowance", label: "Supervisory allowance", group: "Salary structure" },
  { key: "overtime", label: "Fixed overtime / leave salary", group: "Salary structure" },
  { key: "esi_applicable", label: "ESI Yes/No (1/0)", group: "Salary structure" },
  { key: "pf_applicable", label: "PF Yes/No", group: "Salary structure" },
  { key: "lwf_applicable", label: "LWF Yes/No", group: "Salary structure" },
  { key: "bonus_applicable", label: "Annual bonus Yes/No", group: "Salary structure" },
  { key: "gratuity_applicable", label: "Gratuity Yes/No", group: "Salary structure" },
  { key: "pt_applicable", label: "Professional tax Yes/No", group: "Salary structure" },
  { key: "total_days", label: "Total days (worked + offs + leaves)", group: "Month" },
  { key: "days_in_month", label: "Calendar days in month", group: "Month" },
  { key: "month_number", label: "Month number (1 = Jan … 12 = Dec)", group: "Month" },
  { key: "working_days", label: "Days worked", group: "Month" },
  { key: "paid_offs", label: "Weekly & paid offs", group: "Month" },
  { key: "leaves", label: "Leaves", group: "Month" },
  { key: "lop_days", label: "Loss-of-pay days", group: "Month" },
  { key: "incentive", label: "Incentive / OT incentive", group: "Month" },
  { key: "arrears", label: "Arrears", group: "Month" },
  { key: "ex_gratia", label: "Ex-gratia", group: "Month" },
  { key: "manual_adjustment", label: "Other addition (+/−, after statutory)", group: "Month" },
  { key: "advance_recovery", label: "Advance / loan recovery", group: "Month" },
  { key: "other_deduction", label: "Other deduction (reason in remarks)", group: "Month" },
  { key: "professional_tax_input", label: "Professional tax entered manually (extra)", group: "Month" },
  { key: "location", label: "Location text, e.g. \"Haryana (Rohtak)\"", group: "Employee" },
  { key: "state", label: "State for statutory rules: \"Haryana\", \"Karnataka\", \"Delhi\"…", group: "Employee" },
  { key: "designation", label: "Designation text", group: "Employee" },
  { key: "years_of_service", label: "Completed years since joining", group: "Employee" },
];

/** Exact Google Sheet logic (Apr–Sep 2026). Kept for history checks; pay_factor fixed for joiners/leavers. */
export const SHEET_FORMULAS_FY26: FormulaRow[] = [
  // Rates & limits
  { key: "esi_employee_pct", label: "ESI employee %", expr: "0.75%", category: "parameter" },
  { key: "esi_employer_pct", label: "ESI employer %", expr: "3.25%", category: "parameter" },
  { key: "pf_employee_pct", label: "PF employee %", expr: "12%", category: "parameter" },
  { key: "pf_employer_pct", label: "PF employer %", expr: "13%", category: "parameter" },
  { key: "pf_wage_ceiling", label: "PF wage ceiling", expr: "15000", category: "parameter" },
  { key: "bonus_pct", label: "Annual bonus %", expr: "8.33%", category: "parameter" },
  { key: "gratuity_pct", label: "Gratuity %", expr: "4.81%", category: "parameter" },
  { key: "lwf_employee_pct", label: "LWF employee %", expr: "0.2%", category: "parameter" },
  { key: "lwf_employee_cap", label: "LWF employee cap", expr: "34", category: "parameter" },
  { key: "lwf_employer_pct", label: "LWF employer %", expr: "0.4%", category: "parameter" },
  { key: "lwf_employer_cap", label: "LWF employer cap", expr: "68", category: "parameter" },

  // Working values
  { key: "pay_factor", label: "Paid fraction of month (LOP)", expr: "if(days_in_month > 0, max(0, min(1, (days_in_month - lop_days) / days_in_month)), 1)", category: "working" },
  { key: "fixed_monthly", label: "Fixed monthly earnings", expr: "basic + hra + medical + conveyance + mobile + site_allowance + supervisor_allowance + overtime", category: "working" },

  // Earnings
  { key: "e_basic", label: "Basic", expr: "round(basic * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_hra", label: "HRA", expr: "round(hra * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_medical", label: "Medical", expr: "round(medical * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_conveyance", label: "Conveyance", expr: "round(conveyance * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_mobile", label: "Mobile", expr: "round(mobile * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_site_allowance", label: "Site Allowance", expr: "round(site_allowance * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_supervisor_allowance", label: "Supervisor Allowance", expr: "round(supervisor_allowance * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_overtime", label: "Overtime", expr: "round(overtime * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_arrears", label: "Arrears", expr: "arrears", category: "earning", on_slip: true },
  { key: "e_incentive", label: "Incentive", expr: "incentive", category: "earning", on_slip: true },

  // Totals used by statutory calcs
  { key: "gross", label: "Gross Salary", expr: "e_basic + e_hra + e_medical + e_conveyance + e_mobile + e_site_allowance + e_supervisor_allowance + e_overtime + e_arrears + e_incentive", category: "total" },
  { key: "lop_deduction", label: "LOP deduction", expr: "fixed_monthly - (e_basic + e_hra + e_medical + e_conveyance + e_mobile + e_site_allowance + e_supervisor_allowance + e_overtime)", category: "total" },
  { key: "gross_ex_conveyance", label: "Gross excl. conveyance (ESI wage)", expr: "gross - e_conveyance", category: "total" },
  { key: "pf_wage", label: "PF wage (Basic + Supervisor + Arrears)", expr: "e_basic + e_supervisor_allowance + e_arrears", category: "total" },

  // Employee deductions
  { key: "esi_employee", label: "ESI Employee Contribution", expr: "if(esi_applicable, roundup(esi_employee_pct * gross_ex_conveyance, 0), 0)", category: "deduction", on_slip: true },
  { key: "pf_employee", label: "PF Employee Contribution", expr: "if(pf_applicable, if(pf_wage > pf_wage_ceiling, pf_employee_pct * pf_wage_ceiling, pf_wage * pf_employee_pct), 0)", category: "deduction", on_slip: true },
  { key: "lwf_employee", label: "LWF Employee Contribution", expr: "if(lwf_applicable and contains(location, \"Haryana\"), round(min(lwf_employee_pct * gross_ex_conveyance, lwf_employee_cap), 0), 0)", category: "deduction", on_slip: true },
  { key: "professional_tax", label: "Professional Tax", expr: "professional_tax_input", category: "deduction", on_slip: true },

  // Employer contributions
  { key: "esi_employer", label: "ESI Employer Contribution", expr: "if(esi_applicable, roundup(esi_employer_pct * gross_ex_conveyance, 0), 0)", category: "employer", on_slip: true },
  { key: "pf_employer", label: "PF Employer Contribution", expr: "if(pf_applicable, if(pf_wage > pf_wage_ceiling, pf_employer_pct * pf_wage_ceiling, round(pf_wage * pf_employer_pct, 0)), 0)", category: "employer", on_slip: true },
  { key: "lwf_employer", label: "LWF Employer Contribution", expr: "if(lwf_applicable and contains(location, \"Haryana\"), round(min(lwf_employer_pct * gross_ex_conveyance, lwf_employer_cap), 0), 0)", category: "employer", on_slip: true },
  { key: "bonus", label: "Annual Bonus accrual", expr: "if(bonus_applicable, bonus_pct * e_basic, 0)", category: "employer", on_slip: false },
  { key: "gratuity", label: "Gratuity accrual", expr: "if(gratuity_applicable, gratuity_pct * e_basic, 0)", category: "employer", on_slip: false },

  // Final totals
  { key: "total_deductions", label: "Total Employee Deductions", expr: "esi_employee + pf_employee + lwf_employee + professional_tax", category: "total" },
  { key: "net_pay", label: "Total In Hand Salary", expr: "round(gross - total_deductions + manual_adjustment, 2)", category: "total" },
  { key: "other_benefits", label: "Other Benefits (employer cost)", expr: "esi_employer + pf_employer + lwf_employer + bonus + gratuity", category: "total" },
  { key: "ctc", label: "Total Cost To Company", expr: "gross + other_benefits + ex_gratia", category: "total" },
];

/**
 * Default formulas from October 2026.
 *  • Pay is pro-rated on calendar days: paid days = days in month − LOP days (fixes ₹0 for mid-month joiners/leavers).
 *  • EPF wage ceiling ₹25,000 (from 17 Sep 2026); employer share split into EPS / EPF / EDLI / admin.
 *  • Karnataka Professional Tax automatic (₹200/month, ₹300 in February, from ₹25,000 gross).
 *  • Haryana LWF caps ₹35 / ₹70 (from 1 Jan 2026); Karnataka LWF in December (₹50 / ₹100).
 *  • Typed deductions (advance recovery, other deduction) and in-hand rounded to the rupee.
 * Statutory figures should be confirmed with the CA; every number here is editable on the Formulas page.
 */
export const DEFAULT_FORMULAS: FormulaRow[] = [
  // Rates & limits
  { key: "esi_employee_pct", label: "ESI employee %", expr: "0.75%", category: "parameter" },
  { key: "esi_employer_pct", label: "ESI employer %", expr: "3.25%", category: "parameter" },
  { key: "esi_wage_ceiling", label: "ESI wage ceiling (coverage check)", expr: "21000", category: "parameter" },
  { key: "pf_employee_pct", label: "PF employee %", expr: "12%", category: "parameter" },
  { key: "pf_wage_ceiling", label: "EPF wage ceiling", expr: "25000", category: "parameter" },
  { key: "eps_pct", label: "EPS % (part of employer 12%)", expr: "8.33%", category: "parameter" },
  { key: "eps_wage_ceiling", label: "EPS wage ceiling", expr: "25000", category: "parameter" },
  { key: "edli_pct", label: "EDLI %", expr: "0.5%", category: "parameter" },
  { key: "pf_admin_pct", label: "EPF admin charges %", expr: "0.5%", category: "parameter" },
  { key: "bonus_pct", label: "Annual bonus %", expr: "8.33%", category: "parameter" },
  { key: "gratuity_pct", label: "Gratuity %", expr: "4.81%", category: "parameter" },
  { key: "lwf_employee_pct", label: "Haryana LWF employee %", expr: "0.2%", category: "parameter" },
  { key: "lwf_employee_cap", label: "Haryana LWF employee cap", expr: "35", category: "parameter" },
  { key: "lwf_employer_pct", label: "Haryana LWF employer %", expr: "0.4%", category: "parameter" },
  { key: "lwf_employer_cap", label: "Haryana LWF employer cap", expr: "70", category: "parameter" },
  { key: "ka_lwf_employee", label: "Karnataka LWF employee (December)", expr: "50", category: "parameter" },
  { key: "ka_lwf_employer", label: "Karnataka LWF employer (December)", expr: "100", category: "parameter" },
  { key: "ka_pt_threshold", label: "Karnataka PT: gross from", expr: "25000", category: "parameter" },
  { key: "ka_pt_monthly", label: "Karnataka PT per month", expr: "200", category: "parameter" },
  { key: "ka_pt_february", label: "Karnataka PT in February", expr: "300", category: "parameter" },

  // Working values
  { key: "paid_days", label: "Paid days (days in month − LOP)", expr: "max(0, days_in_month - lop_days)", category: "working" },
  { key: "pay_factor", label: "Paid fraction of month", expr: "if(days_in_month > 0, min(1, paid_days / days_in_month), 1)", category: "working" },
  { key: "fixed_monthly", label: "Fixed monthly earnings", expr: "basic + hra + medical + conveyance + mobile + site_allowance + supervisor_allowance + overtime", category: "working" },

  // Earnings
  { key: "e_basic", label: "Basic", expr: "round(basic * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_hra", label: "HRA", expr: "round(hra * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_medical", label: "Medical", expr: "round(medical * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_conveyance", label: "Conveyance", expr: "round(conveyance * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_mobile", label: "Mobile", expr: "round(mobile * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_site_allowance", label: "Site Allowance", expr: "round(site_allowance * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_supervisor_allowance", label: "Supervisor Allowance", expr: "round(supervisor_allowance * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_overtime", label: "Overtime", expr: "round(overtime * pay_factor, 2)", category: "earning", on_slip: true },
  { key: "e_arrears", label: "Arrears", expr: "arrears", category: "earning", on_slip: true },
  { key: "e_incentive", label: "Incentive", expr: "incentive", category: "earning", on_slip: true },

  // Totals used by statutory calcs
  { key: "gross", label: "Gross Salary", expr: "e_basic + e_hra + e_medical + e_conveyance + e_mobile + e_site_allowance + e_supervisor_allowance + e_overtime + e_arrears + e_incentive", category: "total" },
  { key: "lop_deduction", label: "LOP deduction", expr: "fixed_monthly - (e_basic + e_hra + e_medical + e_conveyance + e_mobile + e_site_allowance + e_supervisor_allowance + e_overtime)", category: "total" },
  { key: "gross_ex_conveyance", label: "Gross excl. conveyance (ESI wage)", expr: "gross - e_conveyance", category: "total" },
  { key: "pf_wage", label: "PF wage (Basic + Supervisor + Arrears)", expr: "e_basic + e_supervisor_allowance + e_arrears", category: "total" },
  { key: "pf_wage_capped", label: "EPF wage (capped)", expr: "min(pf_wage, pf_wage_ceiling)", category: "total" },

  // Employee deductions
  { key: "esi_employee", label: "ESI Employee Contribution", expr: "if(esi_applicable, roundup(esi_employee_pct * gross_ex_conveyance, 0), 0)", category: "deduction", on_slip: true },
  { key: "pf_employee", label: "PF Employee Contribution", expr: "if(pf_applicable, round(pf_employee_pct * pf_wage_capped, 0), 0)", category: "deduction", on_slip: true },
  { key: "lwf_employee", label: "LWF Employee Contribution", expr: "if(lwf_applicable, if(state = \"Haryana\", round(min(lwf_employee_pct * gross_ex_conveyance, lwf_employee_cap), 0), if(state = \"Karnataka\" and month_number = 12, ka_lwf_employee, 0)), 0)", category: "deduction", on_slip: true },
  { key: "professional_tax", label: "Professional Tax", expr: "if(state = \"Karnataka\" and gross >= ka_pt_threshold, if(month_number = 2, ka_pt_february, ka_pt_monthly), 0) + professional_tax_input", category: "deduction", on_slip: true },
  { key: "d_advance", label: "Advance Recovery", expr: "advance_recovery", category: "deduction", on_slip: true },
  { key: "d_other", label: "Other Deduction", expr: "other_deduction", category: "deduction", on_slip: true },

  // Employer contributions
  { key: "esi_employer", label: "ESI Employer Contribution", expr: "if(esi_applicable, roundup(esi_employer_pct * gross_ex_conveyance, 0), 0)", category: "employer", on_slip: true },
  { key: "eps", label: "EPS (Pension) 8.33%", expr: "if(pf_applicable, round(eps_pct * min(pf_wage, eps_wage_ceiling), 0), 0)", category: "employer", on_slip: false },
  { key: "epf_employer", label: "EPF employer (12% − EPS)", expr: "if(pf_applicable, round(pf_employee_pct * pf_wage_capped, 0) - eps, 0)", category: "employer", on_slip: false },
  { key: "edli", label: "EDLI", expr: "if(pf_applicable, round(edli_pct * pf_wage_capped, 0), 0)", category: "employer", on_slip: false },
  { key: "pf_admin", label: "EPF admin charges", expr: "if(pf_applicable, round(pf_admin_pct * pf_wage_capped, 0), 0)", category: "employer", on_slip: false },
  { key: "pf_employer", label: "PF Employer Contribution", expr: "eps + epf_employer + edli + pf_admin", category: "employer", on_slip: true },
  { key: "lwf_employer", label: "LWF Employer Contribution", expr: "if(lwf_applicable, if(state = \"Haryana\", round(min(lwf_employer_pct * gross_ex_conveyance, lwf_employer_cap), 0), if(state = \"Karnataka\" and month_number = 12, ka_lwf_employer, 0)), 0)", category: "employer", on_slip: true },
  { key: "bonus", label: "Annual Bonus accrual", expr: "if(bonus_applicable, bonus_pct * e_basic, 0)", category: "employer", on_slip: false },
  { key: "gratuity", label: "Gratuity accrual", expr: "if(gratuity_applicable, gratuity_pct * e_basic, 0)", category: "employer", on_slip: false },

  // Final totals
  { key: "total_deductions", label: "Total Employee Deductions", expr: "esi_employee + pf_employee + lwf_employee + professional_tax + d_advance + d_other", category: "total" },
  { key: "net_pay", label: "Total In Hand Salary", expr: "round(gross - total_deductions + manual_adjustment, 0)", category: "total" },
  { key: "other_benefits", label: "Other Benefits (employer cost)", expr: "esi_employer + pf_employer + lwf_employer + bonus + gratuity", category: "total" },
  { key: "ctc", label: "Total Cost To Company", expr: "gross + other_benefits + ex_gratia", category: "total" },
];

export type StructureFields = {
  basic: number; hra: number; medical: number; conveyance: number; mobile: number;
  site_allowance: number; supervisor_allowance: number; overtime: number;
  esi_applicable: boolean; pf_applicable: boolean; lwf_applicable: boolean;
  bonus_applicable: boolean; gratuity_applicable: boolean; pt_applicable?: boolean;
  extras?: Record<string, number> | null; // custom structure fields usable in formulas
};

export type MonthFields = {
  month: string; // YYYY-MM-01
  working_days: number; paid_offs: number; leaves: number; lop_days: number;
  incentive: number; arrears: number; ex_gratia: number; manual_adjustment: number; professional_tax: number;
  advance_recovery?: number; other_deduction?: number;
};

export type EmployeeFields = { location: string; designation: string; date_of_joining: string | null; state?: string | null };

/** State used for statutory rules: explicit field, else inferred from the location text. */
export function stateOf(state: string | null | undefined, location: string | null | undefined) {
  if (state && state.trim()) return state.trim();
  const l = (location || "").toLowerCase();
  if (l.includes("haryana") || l.includes("rohtak") || l.includes("gurugram") || l.includes("gurgaon") || l.includes("faridabad")) return "Haryana";
  if (l.includes("karnataka") || l.includes("bangalore") || l.includes("bengaluru")) return "Karnataka";
  if (l.includes("delhi")) return "Delhi";
  return "";
}

export function buildContext(s: StructureFields, m: MonthFields, e: EmployeeFields): Ctx {
  const b = (x: boolean | undefined) => (x ? 1 : 0);
  const n = (x: unknown) => Number(x) || 0;
  let yos = 0;
  if (e.date_of_joining) {
    const j = new Date(e.date_of_joining), end = new Date(m.month);
    yos = Math.max(0, Math.floor((end.getTime() - j.getTime()) / (365.25 * 86400000)));
  }
  const ctx: Ctx = {
    basic: n(s.basic), hra: n(s.hra), medical: n(s.medical), conveyance: n(s.conveyance), mobile: n(s.mobile),
    site_allowance: n(s.site_allowance), supervisor_allowance: n(s.supervisor_allowance), overtime: n(s.overtime),
    esi_applicable: b(s.esi_applicable), pf_applicable: b(s.pf_applicable), lwf_applicable: b(s.lwf_applicable),
    bonus_applicable: b(s.bonus_applicable), gratuity_applicable: b(s.gratuity_applicable), pt_applicable: b(s.pt_applicable),
    working_days: n(m.working_days), paid_offs: n(m.paid_offs), leaves: n(m.leaves), lop_days: n(m.lop_days),
    total_days: n(m.working_days) + n(m.paid_offs) + n(m.leaves),
    days_in_month: daysInMonth(m.month),
    month_number: Number(m.month.slice(5, 7)),
    incentive: n(m.incentive), arrears: n(m.arrears), ex_gratia: n(m.ex_gratia),
    manual_adjustment: n(m.manual_adjustment), professional_tax_input: n(m.professional_tax),
    advance_recovery: n(m.advance_recovery), other_deduction: n(m.other_deduction),
    location: e.location || "", designation: e.designation || "", years_of_service: yos,
    state: stateOf(e.state, e.location),
  };
  for (const [k, v] of Object.entries(s.extras || {})) if (/^[A-Za-z_]\w*$/.test(k) && !(k in ctx)) ctx[k] = n(v);
  return ctx;
}

/** Runs the formulas in order. Returns every computed value keyed by formula key. */
export function runFormulas(formulas: FormulaRow[], ctx: Ctx): Record<string, number> {
  const c: Ctx = { ...ctx };
  const out: Record<string, number> = {};
  for (const f of formulas) {
    let v;
    try {
      v = evalNode(parse(f.expr), c);
    } catch (e) {
      throw new Error(`${f.label} (${f.key}): ${(e as Error).message}`);
    }
    const num = typeof v === "number" ? v : Number(v) || 0;
    const clean = Math.round(num * 100) / 100;
    c[f.key] = num; // keep full precision for downstream formulas
    out[f.key] = clean;
  }
  return out;
}

export function calculate(formulas: FormulaRow[], s: StructureFields, m: MonthFields, e: EmployeeFields) {
  return runFormulas(formulas, buildContext(s, m, e));
}

/** Validates a formula set; returns a list of problems (empty = ok). */
export function validateFormulas(formulas: FormulaRow[], extraInputs: string[] = []): string[] {
  const errs: string[] = [];
  const known = new Set([...INPUT_VARIABLES.map((v) => v.key), ...extraInputs]);
  const seen = new Set<string>();
  for (const f of formulas) {
    if (!/^[A-Za-z_]\w*$/.test(f.key)) errs.push(`"${f.key}" is not a valid name (letters, digits, _; no spaces)`);
    if (known.has(f.key) && !seen.has(f.key) && INPUT_VARIABLES.some((v) => v.key === f.key))
      errs.push(`"${f.key}" clashes with an input name`);
    if (seen.has(f.key)) errs.push(`"${f.key}" is defined twice`);
    try {
      const refs = referencedNames(parse(f.expr));
      for (const r of refs)
        if (!known.has(r) && !seen.has(r))
          errs.push(`${f.label}: uses "${r}" which is not an input or a formula defined above it`);
    } catch (e) {
      errs.push(`${f.label}: ${(e as Error).message}`);
    }
    seen.add(f.key);
  }
  for (const k of REQUIRED_KEYS) if (!seen.has(k)) errs.push(`Required formula "${k}" is missing`);
  return errs;
}

/** OT incentive suggestion (Salary Rules tab): salary excl. conveyance / days in month × OT days.
 *  Optional: 3+ OT days earn 1 extra day; add 0.75% ESI. */
export function suggestOtIncentive(
  s: Pick<StructureFields, "basic" | "hra" | "medical" | "mobile" | "site_allowance" | "supervisor_allowance">,
  dim: number, otDays: number, applyExtraDayRule: boolean, addEsi: boolean,
) {
  const paidDays = applyExtraDayRule && otDays >= 3 ? otDays + 1 : otDays;
  const base = Number(s.basic) + Number(s.hra) + Number(s.medical) + Number(s.mobile) + Number(s.site_allowance) + Number(s.supervisor_allowance);
  let amt = (base / dim) * paidDays;
  if (addEsi) amt *= 1.0075;
  return { paidDays, amount: Math.round(amt) };
}

/** Today's date in India (YYYY-MM-DD) – avoids the UTC day being wrong between midnight and 05:30 IST. */
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
/** First day of the current month in India (YYYY-MM-01). */
export const thisMonthIST = () => todayIST().slice(0, 7) + "-01";

export function daysInMonth(monthISO: string) {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthLabel(monthISO: string) {
  const [y, m] = monthISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function monthEnd(monthISO: string) {
  const [y, m] = monthISO.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth(monthISO)).padStart(2, "0")}`;
}

export function financialYear(monthISO: string) {
  const [y, m] = monthISO.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `FY${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const inr = (n: number | null | undefined, dp = 0) =>
  n == null || Number.isNaN(Number(n)) || Number(n) === 0
    ? "-"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
