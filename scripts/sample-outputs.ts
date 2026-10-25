// Generates September 2026 outputs from the imported sheet data, for checking against the files actually used.
import { writeFileSync, mkdirSync } from "node:fs";
import { SHEET_FORMULAS_FY26 } from "../lib/payroll";
import { computeLine, snapshotOf, type Employee } from "../lib/run-logic";
import { hdfcCsv, orgzitCsv, registerCsv, complianceSummary, type LineRow } from "../lib/exports";
import { buildSlipsPdf } from "../lib/slip-pdf";
import { EMPLOYEES, STRUCTURES, HISTORY, ORGZIT, EXCLUDE_FROM_BANK_FILE } from "../data/sheet-import";
import { toStructure } from "../data/to-structure";
import { parseSheetDate } from "./sheet-date";

const out = process.argv[2] || "./sample-out";
mkdirSync(out, { recursive: true });
const month = "2026-09-01";
const lines: LineRow[] = HISTORY[month].map(([code, w, o, l, inc, man], i) => {
  const e = EMPLOYEES.find((x) => x.code === code)!;
  const emp: Employee = {
    id: code, emp_code: code, name: e.name, father_name: e.father_name, designation: e.designation, location: e.location,
    status: e.status, date_of_joining: parseSheetDate(e.doj), date_of_leaving: parseSheetDate(e.dol), uan: e.uan,
    esic_number: e.esic_number, bank_account: e.bank_account, ifsc: e.ifsc, bank_name: null, email: e.email, bank_advice_email: ["Emp 1","Emp 2","Emp 3"].includes(code) ? e.email : "team@spans.co.in",
    orgzit_description: ORGZIT[code]?.[0] ?? null, orgzit_id: ORGZIT[code]?.[1] ?? null,
    include_in_bank_file: !EXCLUDE_FROM_BANK_FILE.includes(code), sort_order: i,
  };
  const snap = snapshotOf(emp);
  const inputs = { working_days: w, paid_offs: o, leaves: l, lop_days: 0, incentive: inc, arrears: 0, ex_gratia: 0, manual_adjustment: man, professional_tax: 0 };
  const r = computeLine(SHEET_FORMULAS_FY26, month, snap, toStructure(STRUCTURES[code]), inputs);
  return { id: code, print_code: `C${i + 1}`, snapshot: snap, ...inputs, ...r, calc: r.calc as Record<string, number> };
});
const run = { id: "x", month, status: "finalized", payment_date: "2026-10-02", formulas: SHEET_FORMULAS_FY26 };
const orgz = { created_by: "Nitin", created_by_id: "nverma@spans.co.in", type_of_transaction: "Check Expense",
  expense_by: "Spans Envirotech Pvt. Ltd. (Check & Reimbursement)", expense_by_id: "hbn43p3pc8", type_of_expense: "Salary",
  gst_input: "Not Applicable", status: "Claimed", fy_ids: { "FY2026-27": "jkb0g662kp" } };

const h = hdfcCsv(run, lines); writeFileSync(`${out}/${h.filename}`, h.csv);
const o = orgzitCsv(run, lines, orgz); writeFileSync(`${out}/${o.filename}`, o.csv);
const g = registerCsv(run, lines); writeFileSync(`${out}/${g.filename}`, g.csv);
console.log("HDFC rows", h.count, "total", h.total, "skipped", h.skipped.map((x) => `${x.name}: ${x.reason}`));
console.log("Orgzit rows", o.count);
console.table(complianceSummary(lines));
const company = { name: "Spans Envirotech Pvt. Ltd.", address: "405-406, Woodbury Towers, Charmwood Village, Surajkund Road, Faridabad-121009",
  pan: "AAACS9538A", cin: "U74899DL1993PTC052932",
  slip_notes: "Salary will be transferred to your bank account by 7th of the month.\nThis is computer generated and does not need signature." };
buildSlipsPdf(company, month, SHEET_FORMULAS_FY26, lines).then((b) => { writeFileSync(`${out}/slips.pdf`, b); console.log("PDF pages", lines.length); });
