// Excel workbook for the PF / ESI consultant: one row per employee with the full month's calculation,
// a statutory summary (PF ECR account-wise totals, ESI, LWF, PT by state) and the rates used.
// Bank, Aadhaar and PAN numbers are left out on purpose.
import ExcelJS from "exceljs";
import { daysInMonth, monthLabel, type FormulaRow } from "./payroll";
import type { LineRow, RunRow } from "./exports";

type Line = LineRow & { structure?: Record<string, unknown> | null };
type Col = {
  group: string; header: string; width?: number; kind?: "text" | "num" | "date" | "int";
  get: (l: Line, c: Record<string, number>) => string | number | null | undefined;
  total?: boolean; needsKey?: string; // column dropped when no line has this calc key
};

const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
const dmy = (iso: string | null | undefined) => (iso ? new Date(iso + "T00:00:00Z") : null);
const param = (f: FormulaRow[], key: string) => { const r = f.find((x) => x.key === key); return r ? Number(String(r.expr).replace("%", "")) : NaN; };

export async function consultantWorkbook(run: RunRow, lines: Line[], company: { name: string }) {
  const f = run.formulas || [];
  const dim = daysInMonth(run.month);
  const pfCeiling = param(f, "pf_wage_ceiling") || 15000;
  const epsCeiling = param(f, "eps_wage_ceiling") || pfCeiling;
  const label = (key: string, fallback: string) => f.find((x) => x.key === key)?.label || fallback;
  const yes = (l: Line, k: string) => (l.structure ? (l.structure[k] ? "Yes" : "No") : "");
  const pfOn = (l: Line, c: Record<string, number>) => (l.structure ? !!l.structure.pf_applicable : n(c.pf_employee) > 0);
  const esiOn = (l: Line, c: Record<string, number>) => (l.structure ? !!l.structure.esi_applicable : n(c.esi_employee) > 0);
  const epfWage = (l: Line, c: Record<string, number>) => (pfOn(l, c) ? (c.pf_wage_capped ?? Math.min(n(c.pf_wage), pfCeiling)) : 0);

  const earnings = f.filter((x) => x.category === "earning");
  const all: Col[] = [
    { group: "Employee", header: "#", width: 5, get: (l) => l.print_code },
    { group: "Employee", header: "Emp #", width: 8, get: (l) => l.snapshot.emp_code },
    { group: "Employee", header: "Name", width: 24, get: (l) => l.snapshot.name },
    { group: "Employee", header: "Father's name", width: 18, get: (l) => l.snapshot.father_name },
    { group: "Employee", header: "Designation", width: 18, get: (l) => l.snapshot.designation },
    { group: "Employee", header: "State", width: 11, get: (l) => (l.snapshot as { state?: string | null }).state || "" },
    { group: "Employee", header: "Location / site", width: 16, get: (l) => l.snapshot.location },
    { group: "Employee", header: "Date of joining", width: 12, kind: "date", get: (l) => l.snapshot.date_of_joining },
    { group: "Employee", header: "Date of leaving", width: 12, kind: "date", get: (l) => l.snapshot.date_of_leaving },
    { group: "Employee", header: "UAN", width: 14, get: (l) => l.snapshot.uan },
    { group: "Employee", header: "ESIC IP no.", width: 13, get: (l) => l.snapshot.esic_number },
    { group: "Employee", header: "PF applies", width: 8, get: (l) => yes(l, "pf_applicable") },
    { group: "Employee", header: "ESI applies", width: 8, get: (l) => yes(l, "esi_applicable") },

    { group: "Days", header: "Days in month", kind: "int", width: 8, get: () => dim },
    { group: "Days", header: "Worked", kind: "num", width: 8, get: (l) => n(l.working_days), total: true },
    { group: "Days", header: "Weekly / paid offs", kind: "num", width: 8, get: (l) => n(l.paid_offs), total: true },
    { group: "Days", header: "Paid leave", kind: "num", width: 8, get: (l) => n(l.leaves), total: true },
    { group: "Days", header: "LOP (NCP days)", kind: "num", width: 8, get: (l) => n(l.lop_days), total: true },
    { group: "Days", header: "Paid days", kind: "num", width: 8, get: (l) => dim - n(l.lop_days), total: true },

    ...earnings.map((e): Col => ({ group: "Earnings (this month)", header: e.label, kind: "num", width: 11, get: (_l, c) => n(c[e.key]), total: true, needsKey: e.key })),
    { group: "Earnings (this month)", header: label("gross", "Gross salary"), kind: "num", width: 12, get: (_l, c) => n(c.gross), total: true },

    { group: "Statutory wages", header: "PF wage (uncapped)", kind: "num", width: 11, get: (l, c) => (pfOn(l, c) ? n(c.pf_wage) : 0), total: true },
    { group: "Statutory wages", header: "EPF wage (ECR)", kind: "num", width: 11, get: (l, c) => epfWage(l, c), total: true },
    { group: "Statutory wages", header: "EPS wage (ECR)", kind: "num", width: 11, get: (l, c) => (pfOn(l, c) ? Math.min(n(c.pf_wage), epsCeiling) : 0), total: true },
    { group: "Statutory wages", header: "EDLI wage (ECR)", kind: "num", width: 11, get: (l, c) => epfWage(l, c), total: true },
    { group: "Statutory wages", header: "ESI wage", kind: "num", width: 11, get: (l, c) => (esiOn(l, c) ? n(c.gross_ex_conveyance) : 0), total: true },

    { group: "Employee deductions", header: "PF employee 12%", kind: "num", width: 10, get: (_l, c) => n(c.pf_employee), total: true },
    { group: "Employee deductions", header: "ESI employee", kind: "num", width: 10, get: (_l, c) => n(c.esi_employee), total: true },
    { group: "Employee deductions", header: "LWF employee", kind: "num", width: 9, get: (_l, c) => n(c.lwf_employee), total: true },
    { group: "Employee deductions", header: "Professional tax", kind: "num", width: 9, get: (_l, c) => n(c.professional_tax), total: true },
    { group: "Employee deductions", header: "Advance recovery", kind: "num", width: 9, get: (_l, c) => n(c.d_advance), total: true, needsKey: "d_advance" },
    { group: "Employee deductions", header: "Other deduction", kind: "num", width: 9, get: (_l, c) => n(c.d_other), total: true, needsKey: "d_other" },
    { group: "Employee deductions", header: "Total deductions", kind: "num", width: 11, get: (_l, c) => n(c.total_deductions), total: true },

    { group: "Pay", header: "Other addition / adjustment", kind: "num", width: 11, get: (l) => n(l.manual_adjustment), total: true },
    { group: "Pay", header: "In-hand salary", kind: "num", width: 12, get: (l) => n(l.net_pay), total: true },

    { group: "Employer contributions", header: "EPS 8.33% (A/c 10)", kind: "num", width: 10, get: (_l, c) => n(c.eps), total: true, needsKey: "eps" },
    { group: "Employer contributions", header: "EPF diff 3.67% (A/c 1)", kind: "num", width: 10, get: (_l, c) => n(c.epf_employer), total: true, needsKey: "epf_employer" },
    { group: "Employer contributions", header: "EDLI 0.5% (A/c 21)", kind: "num", width: 10, get: (_l, c) => n(c.edli), total: true, needsKey: "edli" },
    { group: "Employer contributions", header: "Admin 0.5% (A/c 2)", kind: "num", width: 10, get: (_l, c) => n(c.pf_admin), total: true, needsKey: "pf_admin" },
    { group: "Employer contributions", header: "PF employer total", kind: "num", width: 11, get: (_l, c) => n(c.pf_employer), total: true },
    { group: "Employer contributions", header: "ESI employer", kind: "num", width: 10, get: (_l, c) => n(c.esi_employer), total: true },
    { group: "Employer contributions", header: "LWF employer", kind: "num", width: 9, get: (_l, c) => n(c.lwf_employer), total: true },
    { group: "Employer contributions", header: "Bonus accrual", kind: "num", width: 10, get: (_l, c) => n(c.bonus), total: true },
    { group: "Employer contributions", header: "Gratuity accrual", kind: "num", width: 10, get: (_l, c) => n(c.gratuity), total: true },
    { group: "Employer contributions", header: "Cost to company", kind: "num", width: 12, get: (l) => n(l.ctc), total: true },

    { group: "Notes", header: "Remarks", width: 28, get: (l) => [l.remarks, l.error ? `ERROR: ${l.error}` : ""].filter(Boolean).join(" · ") },
  ];
  const cols = all.filter((c) => !c.needsKey || lines.some((l) => l.calc && c.needsKey! in l.calc));

  const wb = new ExcelJS.Workbook();
  wb.creator = company.name;
  wb.created = new Date();
  const draft = run.status !== "finalized";
  const title = `${company.name} · Payroll ${monthLabel(run.month)}${draft ? " · DRAFT for review (may change)" : " · Finalized"}`;
  const brand = "FF1C5573", band = "FFEEF1F4";
  const thin = { style: "thin" as const, color: { argb: "FFD5DAE0" } };

  // ── Sheet 1: one row per employee
  const ws = wb.addWorksheet("Employees", { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: brand } };
  ws.getCell("A2").value = `${lines.length} employees · ${dim} days · generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} · amounts in ₹ per month`;
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF616A75" } };
  if (draft) ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF9A6200" } };

  // Row 3: group bands; row 4: headers
  let start = 1;
  cols.forEach((c, i) => {
    const next = cols[i + 1];
    if (!next || next.group !== c.group) {
      const from = ws.getRow(3).getCell(start), to = ws.getRow(3).getCell(i + 1);
      if (i + 1 > start) ws.mergeCells(3, start, 3, i + 1);
      from.value = c.group;
      from.alignment = { horizontal: "center" };
      from.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      for (let k = start; k <= i + 1; k++) ws.getRow(3).getCell(k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand } };
      void to;
      start = i + 2;
    }
  });
  const head = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9.5 };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: c.kind && c.kind !== "text" ? "center" : "left" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
    cell.border = { bottom: thin, top: thin, left: thin, right: thin };
    ws.getColumn(i + 1).width = c.width || 12;
  });
  head.height = 42;

  const first = 5;
  lines.forEach((l, r) => {
    const c = (l.calc || {}) as Record<string, number>;
    const row = ws.getRow(first + r);
    cols.forEach((col, i) => {
      const v = col.get(l, c);
      const cell = row.getCell(i + 1);
      if (col.kind === "date") { cell.value = dmy(v as string | null); cell.numFmt = "dd-mmm-yyyy"; }
      else if (col.kind === "num" || col.kind === "int") { cell.value = n(v); cell.numFmt = Number.isInteger(n(v)) ? "#,##0" : "#,##0.00"; }
      else cell.value = v == null ? "" : String(v);
      cell.border = { bottom: thin, left: thin, right: thin };
      if (l.error) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE7E5" } };
    });
  });
  // Totals with live SUM formulas
  const last = first + lines.length - 1;
  const tot = ws.getRow(last + 1);
  tot.getCell(3).value = "TOTAL";
  cols.forEach((col, i) => {
    const cell = tot.getCell(i + 1);
    if (col.total && lines.length) {
      const L = ws.getColumn(i + 1).letter;
      const sum = lines.reduce((a, l) => a + n(col.get(l, (l.calc || {}) as Record<string, number>)), 0);
      cell.value = { formula: `SUM(${L}${first}:${L}${last})`, result: sum };
      cell.numFmt = "#,##0";
    }
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
    cell.border = { top: { style: "medium", color: { argb: brand } }, bottom: thin };
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };

  // ── Sheet 2: statutory summary (what the challans should add up to)
  const s = wb.addWorksheet("Statutory summary", { pageSetup: { orientation: "portrait", fitToPage: true, paperSize: 9 } });
  s.columns = [{ width: 38 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  const H = (r: number, text: string) => { const c = s.getCell(r, 1); c.value = text; c.font = { bold: true, size: 12, color: { argb: brand } }; };
  const sum = (fn: (l: Line, c: Record<string, number>) => number) => lines.reduce((a, l) => a + fn(l, (l.calc || {}) as Record<string, number>), 0);
  s.getCell("A1").value = title; s.getCell("A1").font = { bold: true, size: 13 };
  let r = 3;
  const tableRow = (cells: (string | number)[], bold = false, header = false) => {
    cells.forEach((v, i) => {
      const c = s.getCell(r, i + 1);
      c.value = v;
      if (typeof v === "number") c.numFmt = "#,##0";
      c.font = { bold: bold || header, size: header ? 9.5 : 10.5 };
      if (header) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: band } };
      c.border = { bottom: thin };
    });
    r++;
  };

  const pfMembers = lines.filter((l) => n(l.calc?.pf_employee) > 0);
  H(r++, "PF – ECR / challan (account-wise)");
  tableRow(["", "Amount (₹)"], false, true);
  const ac1 = sum((_l, c) => n(c.pf_employee) + n(c.epf_employer));
  const ac10 = sum((_l, c) => n(c.eps)), ac21 = sum((_l, c) => n(c.edli)), ac2 = sum((_l, c) => n(c.pf_admin));
  tableRow(["Members", pfMembers.length]);
  tableRow(["EPF wages", sum((l, c) => epfWage(l, c))]);
  tableRow(["EPS wages", sum((l, c) => (pfOn(l, c) ? Math.min(n(c.pf_wage), epsCeiling) : 0))]);
  tableRow(["A/c 1 – EPF (employee 12% + employer 3.67%)", ac1]);
  tableRow(["A/c 10 – EPS (employer 8.33%)", ac10]);
  tableRow(["A/c 21 – EDLI (0.5%)", ac21]);
  tableRow(["A/c 2 – Admin charges (0.5%)", ac2]);
  tableRow(["Total PF challan", ac1 + ac10 + ac21 + ac2], true);
  tableRow(["NCP (LOP) days, PF members", pfMembers.reduce((a, l) => a + n(l.lop_days), 0)]);
  r++;

  const esiMembers = lines.filter((l) => n(l.calc?.esi_employee) > 0);
  H(r++, "ESI – monthly contribution");
  tableRow(["", "Amount (₹)"], false, true);
  tableRow(["Insured persons", esiMembers.length]);
  tableRow(["ESI wages", sum((l, c) => (esiOn(l, c) ? n(c.gross_ex_conveyance) : 0))]);
  tableRow(["Employee 0.75%", sum((_l, c) => n(c.esi_employee))]);
  tableRow(["Employer 3.25%", sum((_l, c) => n(c.esi_employer))]);
  tableRow(["Total ESI challan", sum((_l, c) => n(c.esi_employee) + n(c.esi_employer))], true);
  r++;

  H(r++, "By state (PF / ESI / LWF / Professional tax)");
  tableRow(["State", "PF (EE + ER)", "ESI (EE + ER)", "LWF (EE + ER)", "Prof. tax"], false, true);
  const states = Array.from(new Set(lines.map((l) => (l.snapshot as { state?: string | null }).state || "Other"))).sort();
  for (const st of states) {
    const ls = lines.filter((l) => ((l.snapshot as { state?: string | null }).state || "Other") === st);
    const t = (k: string[]) => ls.reduce((a, l) => a + k.reduce((b, key) => b + n(l.calc?.[key]), 0), 0);
    tableRow([`${st} (${ls.length})`, t(["pf_employee", "pf_employer"]), t(["esi_employee", "esi_employer"]), t(["lwf_employee", "lwf_employer"]), t(["professional_tax"])]);
  }
  r++;
  if (draft) {
    const c = s.getCell(r, 1);
    c.value = "DRAFT: figures may change before the month is finalized. Please send challans against the finalized figures.";
    c.font = { italic: true, color: { argb: "FF9A6200" } };
  }

  // ── Sheet 3: rates and rules used
  const p = wb.addWorksheet("Rates used");
  p.columns = [{ width: 42 }, { width: 14 }];
  p.getCell("A1").value = `Rates and ceilings used for ${monthLabel(run.month)}`; p.getCell("A1").font = { bold: true, size: 12, color: { argb: brand } };
  let pr = 3;
  for (const row of f.filter((x) => x.category === "parameter")) {
    p.getCell(pr, 1).value = row.label; p.getCell(pr, 2).value = row.expr; pr++;
  }
  pr++;
  p.getCell(pr++, 1).value = "PF wage = Basic + Supervisor allowance + Arrears (EPF/EDLI wage capped at the EPF ceiling; EPS wage at the EPS ceiling).";
  p.getCell(pr++, 1).value = "ESI wage = Gross salary excluding conveyance.";
  p.getCell(pr++, 1).value = "Bank, Aadhaar and PAN numbers are not included in this file.";

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `Spans ${monthLabel(run.month)} Payroll for PF-ESI review${draft ? " - DRAFT" : ""}.xlsx` };
}
