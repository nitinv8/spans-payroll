// Payroll checks shown before exporting / finalizing a month. Pure functions (server + browser).
import { daysInMonth } from "./payroll";
import type { LineRow } from "./exports";

export type Check = { level: "error" | "warn"; who: string; text: string };

type Line = LineRow & { structure?: Record<string, unknown> | null; employee_id?: string };

const num = (v: unknown) => Number(v) || 0;

/** Monthly ESI wage from the salary structure (excludes conveyance and OT/incentive, as for the coverage test). */
export function structureEsiWage(s: Record<string, unknown> | null | undefined) {
  if (!s) return 0;
  return num(s.basic) + num(s.hra) + num(s.medical) + num(s.mobile) + num(s.site_allowance) + num(s.supervisor_allowance) + num(s.overtime);
}

export function lineChecks(month: string, lines: Line[], opts: { esiCeiling?: number; previousBank?: Record<string, string | null> } = {}): Check[] {
  const out: Check[] = [];
  const dim = daysInMonth(month);
  const m = Number(month.slice(5, 7));
  const periodStart = m === 4 || m === 10; // ESI contribution periods: Apr–Sep and Oct–Mar
  const ceiling = opts.esiCeiling ?? 21000;

  for (const l of lines) {
    const who = l.snapshot?.name ?? "?";
    if (l.error) { out.push({ level: "error", who, text: l.error }); continue; }

    const days = num(l.working_days) + num(l.paid_offs) + num(l.leaves) + num(l.lop_days);
    if (days !== 0 && days !== dim) out.push({ level: "warn", who, text: `Days add up to ${days}, not ${dim} (worked + offs + paid leave + LOP).` });

    if (!l.remarks && (num(l.other_deduction) !== 0 || num(l.manual_adjustment) !== 0))
      out.push({ level: "warn", who, text: "Other deduction / addition has no reason in remarks." });

    const gross = num(l.calc?.gross);
    const totalDeducted = gross - num(l.net_pay); // everything taken off, statutory + recoveries + negative adjustments
    if (gross > 0 && totalDeducted > gross * 0.5)
      out.push({ level: "warn", who, text: "Total deductions exceed 50% of wages (Code on Wages limit)." });

    const s = l.structure as Record<string, unknown> | null | undefined;
    if (s) {
      const wage = structureEsiWage(s);
      const esiOn = !!s.esi_applicable;
      if (!esiOn && wage > 0 && wage <= ceiling)
        out.push({ level: "warn", who, text: `ESI wage ₹${wage.toLocaleString("en-IN")} is within the ₹${ceiling.toLocaleString("en-IN")} limit but ESI is switched off.` });
      if (esiOn && wage > ceiling && periodStart)
        out.push({ level: "warn", who, text: `ESI wage ₹${wage.toLocaleString("en-IN")} is above ₹${ceiling.toLocaleString("en-IN")} at the start of a contribution period – ESI may no longer apply from this month.` });
    }

    const prev = opts.previousBank?.[l.employee_id ?? ""];
    const cur = (l.snapshot?.bank_account || "").replace(/\s/g, "");
    if (prev !== undefined && prev !== null && cur && prev.replace(/\s/g, "") !== cur)
      out.push({ level: "warn", who, text: `Bank account changed since last month (was ending ${prev.slice(-4)}, now ${cur.slice(-4)}). Confirm with the employee before paying.` });
  }
  return out;
}
