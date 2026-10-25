import { financialYear, monthLabel, todayIST, type FormulaRow } from "./payroll";
import type { Snapshot } from "./run-logic";

export type RunRow = { id: string; month: string; status: string; payment_date: string | null; formulas: FormulaRow[] };
export type LineRow = {
  id: string; print_code: string | null; snapshot: Snapshot; calc: Record<string, number>;
  working_days: number; paid_offs: number; leaves: number; lop_days: number; incentive: number; arrears: number;
  ex_gratia: number; manual_adjustment: number; professional_tax: number;
  advance_recovery?: number; other_deduction?: number; updated_at?: string;
  net_pay: number | null; gross: number | null; ctc: number | null; error: string | null; remarks?: string | null;
};
export type OrgzitSettings = {
  created_by: string; created_by_id: string; type_of_transaction: string; expense_by: string; expense_by_id: string;
  type_of_expense: string; gst_input: string; status: string; fy_ids: Record<string, string>;
};

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const monthTag = (month: string) => monthLabel(month).replace(/\s+/g, ""); // "September2026"

// Header exactly as in "HDFC September 2026 Salary Transfer Sheet.csv"
export const HDFC_HEADER = [
  "Transaction Type (N – NFET, R – RTGS & for I - within HDFC transfer)",
  "Beneficiary Code (Mandatory In case of within HDFC transfer and need to metion benefiicary account number)",
  "Beneficiary Account Number", "Amount to be transferred",
  "Beneficiary Name (Upto 40 character without any special character)",
  "Drawee Location", "Print Location", "Bene Address 1", "Bene Address 2", "Bene Address 3", "Bene Address 4", "Bene Address 5",
  "Instruction Reference Number",
  "Customer Reference Number(Which needs to be reflected in statement upto character upto 20)",
  "Payment details 1", "Payment details 2", "Payment details 3", "Payment details 4", "Payment details 5", "Payment details 6", "Payment details 7",
  "Cheque Number", "Transaction Date (DD/MM/YYYY)", "MICR Number", "IFSC Code", "Beneficiary Bank Name", "Beneficiary Bank Branch Name", "Beneficiary email id",
];

export function hdfcCsv(run: RunRow, lines: LineRow[]) {
  const date = ddmmyyyy(run.payment_date || todayIST());
  const ref = `Salary${monthTag(run.month)}`.slice(0, 20);
  const skipped: string[] = [];
  const rows: unknown[][] = [HDFC_HEADER];
  for (const l of lines) {
    const s = l.snapshot;
    const amt = Math.round(Number(l.net_pay) || 0);
    if (!s.include_in_bank_file) { skipped.push(`${s.name} (excluded from bank file)`); continue; }
    if (amt <= 0) { skipped.push(`${s.name} (amount ${amt})`); continue; }
    if (!s.bank_account || !s.ifsc) { skipped.push(`${s.name} (missing bank details)`); continue; }
    const acct = s.bank_account.replace(/\s/g, "");
    const ifsc = s.ifsc.replace(/\s/g, "").toUpperCase();
    const within = ifsc.startsWith("HDFC");
    const name = s.name.replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
    rows.push([
      within ? "I" : "N", within ? acct : "", acct, amt, name,
      "", "", "", "", "", "", "", "", ref,
      "", "", "", "", "", "", "", "", date, "", ifsc, "", "", s.bank_advice_email || s.email || "",
    ]);
  }
  return { csv: toCsv(rows), count: rows.length - 1, skipped, filename: `HDFC ${monthLabel(run.month)} Salary Transfer Sheet.csv` };
}

export const ORGZIT_HEADER = [
  "Vendor", "<Vendor>_id", "Date", "Description", "Financial Year", "<Financial Year>_id", "Created By", "<Created By>_id",
  "Type of Transaction", "Expense By", "<Expense By>_id", "Type of Expense", "Amount", "Supporting Document", "GST Input", "TDS", "Status",
];

export function orgzitCsv(run: RunRow, lines: LineRow[], o: OrgzitSettings) {
  const fy = financialYear(run.month);
  const rows: unknown[][] = [ORGZIT_HEADER];
  const missing: string[] = [];
  for (const l of lines) {
    const s = l.snapshot;
    const amt = Math.round(Number(l.net_pay) || 0);
    if (amt <= 0) continue;
    if (!s.orgzit_id) missing.push(s.name);
    rows.push([
      s.orgzit_description || s.name, s.orgzit_id || "", run.month, `Salary ${monthLabel(run.month)}`, fy, o.fy_ids?.[fy] || "",
      o.created_by, o.created_by_id, o.type_of_transaction, o.expense_by, o.expense_by_id, o.type_of_expense, amt, "",
      o.gst_input, "", o.status,
    ]);
  }
  const fyMissing = !o.fy_ids?.[fy];
  return { csv: toCsv(rows), count: rows.length - 1, missing, fyMissing, fy, filename: `Orgzit ${monthLabel(run.month)} Salary Upload.csv` };
}

/** Full salary register – same columns as the Google Sheet salary tab, plus any custom formulas. */
export function registerCsv(run: RunRow, lines: LineRow[]) {
  const shown = run.formulas.filter((f) => f.category !== "parameter");
  const header = [
    "Print Code", "Employee Name", "Father's Name", "Employee #", "Employment Status", "Month-year", "UAN", "Title", "Location",
    "Date of Joining", "Working Days", "Paid Offs", "Leaves", "LOP Days", "Total Days", "Incentive (input)", "Arrears (input)", "Ex-Gratia",
    "Manual Adjustment", "Professional Tax (input)", ...shown.map((f) => f.label), "Bank Account Number", "IFSC", "Email", "Remarks",
  ];
  const rows: unknown[][] = [header];
  for (const l of lines) {
    const s = l.snapshot;
    rows.push([
      l.print_code, s.name, s.father_name, s.emp_code, s.status, monthLabel(run.month), s.uan, s.designation, s.location,
      s.date_of_joining, l.working_days, l.paid_offs, l.leaves, l.lop_days, Number(l.working_days) + Number(l.paid_offs) + Number(l.leaves),
      l.incentive, l.arrears, l.ex_gratia, l.manual_adjustment, l.professional_tax,
      ...shown.map((f) => l.calc?.[f.key] ?? ""), s.bank_account, s.ifsc, s.email, l.error || l.remarks || "",
    ]);
  }
  return { csv: toCsv(rows), filename: `Spans ${monthLabel(run.month)} Salary Register.csv` };
}

/** PF / ESI / LWF totals grouped by state (ESIC is paid separately for Haryana and Karnataka). */
export function complianceSummary(lines: LineRow[]) {
  const state = (loc: string | null) => {
    const l = (loc || "").toLowerCase();
    if (l.includes("haryana")) return "Haryana";
    if (l.includes("karnataka") || l.includes("bangalore") || l.includes("bengaluru")) return "Karnataka";
    if (l.includes("delhi")) return "Delhi";
    return loc || "Other";
  };
  const by: Record<string, { state: string; heads: number; esi_wage: number; esi_emp: number; esi_er: number; pf_heads: number; pf_wage: number; pf_emp: number; pf_er: number; lwf_emp: number; lwf_er: number; pt: number; pt_heads: number }> = {};
  for (const l of lines) {
    const c = l.calc || {};
    const k = (l.snapshot as { state?: string | null }).state || state(l.snapshot.location);
    const r = (by[k] ||= { state: k, heads: 0, esi_wage: 0, esi_emp: 0, esi_er: 0, pf_heads: 0, pf_wage: 0, pf_emp: 0, pf_er: 0, lwf_emp: 0, lwf_er: 0, pt: 0, pt_heads: 0 });
    if ((c.esi_employee || 0) > 0) { r.heads++; r.esi_wage += c.gross_ex_conveyance || 0; }
    r.esi_emp += c.esi_employee || 0; r.esi_er += c.esi_employer || 0;
    if ((c.pf_employee || 0) > 0) { r.pf_heads++; r.pf_wage += Math.min(c.pf_wage || 0, c.pf_wage_ceiling || 15000); }
    r.pf_emp += c.pf_employee || 0; r.pf_er += c.pf_employer || 0;
    r.lwf_emp += c.lwf_employee || 0; r.lwf_er += c.lwf_employer || 0;
    if ((c.professional_tax || 0) > 0) { r.pt_heads++; r.pt += c.professional_tax || 0; }
  }
  return Object.values(by).sort((a, b) => a.state.localeCompare(b.state));
}
