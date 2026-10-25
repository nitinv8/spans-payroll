import { calculate, daysInMonth, monthEnd, type FormulaRow, type StructureFields } from "./payroll";

export type Employee = {
  id: string; emp_code: string; name: string; father_name: string | null; designation: string | null;
  location: string | null; status: string; date_of_joining: string | null; date_of_leaving: string | null;
  uan: string | null; esic_number: string | null; bank_account: string | null; ifsc: string | null; bank_name: string | null;
  email: string | null; bank_advice_email?: string | null; orgzit_description: string | null; orgzit_id: string | null; include_in_bank_file: boolean;
  sort_order: number; pan?: string | null;
};

export type Structure = StructureFields & { id: string; employee_id: string; effective_from: string; remarks?: string | null };

export type LineInputs = {
  working_days: number; paid_offs: number; leaves: number; lop_days: number; incentive: number; arrears: number;
  ex_gratia: number; manual_adjustment: number; professional_tax: number;
};

export const empNum = (code: string) => Number((code.match(/\d+/) || ["9999"])[0]);

export function sortEmployees<T extends { sort_order: number; emp_code: string }>(list: T[]) {
  return [...list].sort((a, b) => a.sort_order - b.sort_order || empNum(a.emp_code) - empNum(b.emp_code));
}

/** Employees who should appear in a month's payroll. */
export function eligibleForMonth(e: Employee, month: string) {
  if (e.status === "Draft") return false; // offer/interview stage – never processed in payroll
  const end = monthEnd(month);
  if (e.date_of_joining && e.date_of_joining > end) return false;
  if (e.date_of_leaving) return e.date_of_leaving >= month;
  return e.status === "Active";
}

export function structureForMonth(structs: Structure[], month: string) {
  const end = monthEnd(month);
  return structs
    .filter((s) => s.effective_from <= end)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
}

/** Default attendance: Sundays as paid offs, the rest as working days; days outside employment as LOP. */
export function defaultDays(e: Employee, month: string) {
  const dim = daysInMonth(month);
  const [y, m] = month.split("-").map(Number);
  const start = e.date_of_joining && e.date_of_joining > month ? Number(e.date_of_joining.slice(8, 10)) : 1;
  const end = e.date_of_leaving && e.date_of_leaving < monthEnd(month) ? Number(e.date_of_leaving.slice(8, 10)) : dim;
  let sundays = 0, worked = 0;
  for (let d = start; d <= end; d++) {
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) sundays++;
    else worked++;
  }
  const notEmployed = dim - (end - start + 1);
  return { working_days: worked, paid_offs: sundays, leaves: 0, lop_days: notEmployed > 0 ? notEmployed : 0, leaves_out: notEmployed };
}

export function snapshotOf(e: Employee) {
  return {
    name: e.name, father_name: e.father_name, emp_code: e.emp_code, designation: e.designation, location: e.location,
    status: e.status, date_of_joining: e.date_of_joining, date_of_leaving: e.date_of_leaving, uan: e.uan,
    esic_number: e.esic_number, bank_account: e.bank_account, ifsc: e.ifsc, bank_name: e.bank_name, email: e.email, bank_advice_email: e.bank_advice_email ?? null,
    orgzit_description: e.orgzit_description, orgzit_id: e.orgzit_id, include_in_bank_file: e.include_in_bank_file,
  };
}

export type Snapshot = ReturnType<typeof snapshotOf>;

export function structureValues(s: Structure | StructureFields) {
  return {
    basic: Number(s.basic), hra: Number(s.hra), medical: Number(s.medical), conveyance: Number(s.conveyance),
    mobile: Number(s.mobile), site_allowance: Number(s.site_allowance), supervisor_allowance: Number(s.supervisor_allowance),
    overtime: Number(s.overtime), esi_applicable: !!s.esi_applicable, pf_applicable: !!s.pf_applicable,
    lwf_applicable: !!s.lwf_applicable, bonus_applicable: !!s.bonus_applicable, gratuity_applicable: !!s.gratuity_applicable,
    pt_applicable: !!s.pt_applicable, extras: s.extras || {},
  };
}

/** Computes a line. Returns calc + headline numbers, or an error message. */
export function computeLine(
  formulas: FormulaRow[], month: string, snap: Pick<Snapshot, "location" | "designation" | "date_of_joining">,
  structure: StructureFields | null, inputs: LineInputs,
) {
  if (!structure) return { calc: {}, gross: null, net_pay: null, ctc: null, error: "No salary structure for this month" };
  try {
    const calc = calculate(formulas, structure, { month, ...inputs }, {
      location: snap.location || "", designation: snap.designation || "", date_of_joining: snap.date_of_joining,
    });
    return { calc, gross: calc.gross, net_pay: calc.net_pay, ctc: calc.ctc, error: null as string | null };
  } catch (e) {
    return { calc: {}, gross: null, net_pay: null, ctc: null, error: (e as Error).message };
  }
}
