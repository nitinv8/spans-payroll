// Salary break-up for one salary structure: what a full month pays, and what 12 full months add up to.
// Used by the salary preview on the employee page, the draft (candidate) panel and the break-up PDF.
// Nothing is saved.
import { parse, referencedNames } from "./formula";
import { daysInMonth, type FormulaRow, type StructureFields } from "./payroll";
import { computeLine, type Snapshot } from "./run-logic";

export type BreakupRow = { key: string; label: string; expr: string; monthly: number; annual: number };
export type Breakup = {
  month: string;
  earnings: BreakupRow[]; deductions: BreakupRow[]; employer: BreakupRow[];
  gross: { monthly: number; annual: number };
  deductionsTotal: { monthly: number; annual: number };
  net: { monthly: number; annual: number };
  ctc: { monthly: number; annual: number };
  error: string | null;
};

const addMonths = (iso: string, n: number) => {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

/** First day of the month a revision is first paid in: the later of its effective month and `from`. */
export function previewMonth(effectiveFrom: string | null | undefined, from: string) {
  const eff = effectiveFrom ? `${effectiveFrom.slice(0, 7)}-01` : from;
  return eff > from ? eff : from;
}

/** Employer items that make up CTC: whatever the "other_benefits" total (or CTC) adds up, else on-slip employer rows. */
function employerKeys(formulas: FormulaRow[]) {
  const employer = formulas.filter((f) => f.category === "employer");
  const keys = new Set(employer.map((f) => f.key));
  for (const total of ["other_benefits", "ctc"]) {
    const f = formulas.find((x) => x.key === total);
    if (!f) continue;
    try {
      const used = Array.from(referencedNames(parse(f.expr))).filter((k) => keys.has(k));
      if (used.length) return used;
    } catch { /* fall through */ }
  }
  return employer.filter((f) => f.on_slip !== false).map((f) => f.key);
}

export function salaryBreakup(
  formulas: FormulaRow[], month: string, snap: Pick<Snapshot, "location" | "designation" | "date_of_joining"> & { state?: string | null },
  structure: StructureFields,
): Breakup {
  // Full attendance; the person is treated as employed all year so joining dates don't create LOP.
  const full = (m: string) => ({ working_days: daysInMonth(m), paid_offs: 0, leaves: 0, lop_days: 0, incentive: 0, arrears: 0,
    ex_gratia: 0, manual_adjustment: 0, professional_tax: 0, advance_recovery: 0, other_deduction: 0 });
  const s = { ...snap, date_of_joining: null };
  const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i));
  const results = months.map((m) => computeLine(formulas, m, s, structure, full(m)));
  const first = results[0];
  const empty = { monthly: 0, annual: 0 };
  if (first.error) return { month, earnings: [], deductions: [], employer: [], gross: empty, deductionsTotal: empty, net: empty, ctc: empty, error: first.error };

  const val = (k: string, i = 0) => Number((results[i].calc as Record<string, number>)[k]) || 0;
  const yr = (k: string) => results.reduce((a, r) => a + (Number((r.calc as Record<string, number>)[k]) || 0), 0);
  const row = (f: FormulaRow): BreakupRow => ({ key: f.key, label: f.label, expr: f.expr, monthly: val(f.key), annual: yr(f.key) });
  const nonZero = (r: BreakupRow) => Math.abs(r.monthly) >= 0.5 || Math.abs(r.annual) >= 0.5;

  const earnings = formulas.filter((f) => f.category === "earning" && f.on_slip !== false).map(row).filter(nonZero);
  const deductions = formulas.filter((f) => f.category === "deduction" && f.on_slip !== false).map(row).filter(nonZero);
  const ek = employerKeys(formulas);
  const employer = ek.map((k) => formulas.find((f) => f.key === k)!).filter(Boolean).map(row).filter(nonZero);
  const pair = (k: string) => ({ monthly: val(k), annual: yr(k) });
  return {
    month, earnings, deductions, employer,
    gross: pair("gross"), deductionsTotal: pair("total_deductions"), net: pair("net_pay"), ctc: pair("ctc"), error: null,
  };
}

/** Plain-English names for the standard rows; custom rows keep their own label. */
const FRIENDLY: Record<string, string> = {
  pf_employee: "Provident Fund (PF)", esi_employee: "Employees' State Insurance (ESI)", lwf_employee: "Labour Welfare Fund (LWF)",
  professional_tax: "Professional tax", d_advance: "Advance recovery", d_other: "Other deduction",
  pf_employer: "Provident Fund (PF): company share", esi_employer: "ESI: company share", lwf_employer: "LWF: company share",
  bonus: "Annual bonus (accrued)", gratuity: "Gratuity (accrued)",
};
export const friendlyLabel = (r: { key: string; label: string }) => FRIENDLY[r.key] ?? r.label;

/** Picks the formula version in force for a month from a list of versions. */
export function formulasForMonth<T extends { effective_from: string; formulas: unknown }>(sets: T[] | null | undefined, month: string, fallback: FormulaRow[]) {
  const end = `${month.slice(0, 7)}-31`;
  const s = (sets || []).filter((x) => x.effective_from <= end).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
  const f = s?.formulas as FormulaRow[] | undefined;
  return Array.isArray(f) && f.length ? f : fallback;
}
