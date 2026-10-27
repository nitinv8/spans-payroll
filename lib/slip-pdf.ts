// Salary slip PDF – same layout as the "FY2026-27-Salary Slips" tab, generated server-side with pdf-lib.
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { monthLabel, todayIST, type FormulaRow } from "./payroll";
import type { LineRow } from "./exports";
import { friendlyLabel, type Breakup } from "./breakup";

export type Company = { name: string; address: string | null; pan: string | null; cin: string | null; slip_notes: string | null };

const fmt = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 0.005) return "-";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? " " + two(n % 100) : ""}` : two(n));
export function rupeesInWords(amount: number) {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `Rupees ${parts.join(" ")} Only`;
}

// Standard PDF fonts only cover Latin-1; replace anything else so a custom label can never break the PDF.
const safe = (t: string | null | undefined) =>
  String(t ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/₹/g, "Rs.").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

const dmy = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");
};

export type SlipMode = "final" | "provisional" | "candidate";

function drawSlip(page: PDFPage, font: PDFFont, bold: PDFFont, company: Company, month: string, formulas: FormulaRow[], l: LineRow, mode: SlipMode = "final") {
  const draft = mode === "candidate";
  const { width, height } = page.getSize();
  if (draft) {
    page.drawText("DRAFT", { x: 120, y: 260, size: 130, font: bold, color: rgb(0.88, 0.9, 0.93), rotate: degrees(35) });
  }
  const M = 48;
  const ink = rgb(0.1, 0.12, 0.15), muted = rgb(0.4, 0.43, 0.48), line = rgb(0.8, 0.82, 0.85), band = rgb(0.93, 0.95, 0.97);
  let y = height - M;
  const text = (t: string, x: number, yy: number, size = 9.5, f = font, color = ink) =>
    page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, xr: number, yy: number, size = 9.5, f = font) => text(t, xr - f.widthOfTextAtSize(safe(t), size), yy, size, f);
  const hr = (yy: number) => page.drawLine({ start: { x: M, y: yy }, end: { x: width - M, y: yy }, thickness: 0.6, color: line });

  // Header
  text(company.name, M, y, 15, bold); y -= 15;
  if (company.address) { text(company.address, M, y, 8.5, font, muted); y -= 11; }
  text([company.pan && `PAN: ${company.pan}`, company.cin && `CIN: ${company.cin}`].filter(Boolean).join("     "), M, y, 8.5, font, muted);
  right(draft ? "DRAFT SALARY BREAK-UP" : "SALARY SLIP", width - M, height - M, 11, bold);
  right(draft ? "Proposed monthly salary" : monthLabel(month), width - M, height - M - 14, 10);
  if (mode === "provisional") right("PROVISIONAL - month not finalized", width - M, height - M - 28, 8.5, bold);
  y -= 12; hr(y); y -= 20;

  // Employee block
  const s = l.snapshot;
  const left: [string, string][] = [
    ["Name of Employee", s.name], ["Employee #", s.emp_code], ["Designation", s.designation || ""], ["Location", s.location || ""],
  ];
  const rightCol: [string, string][] = [
    ["UAN", s.uan || "Not applicable"], ["Date of Joining", dmy(s.date_of_joining)],
    draft ? ["Status", "Proposed (not yet joined)"] : ["Bank A/c", s.bank_account ? `XXXX${s.bank_account.replace(/\s/g, "").slice(-4)}` : ""],
    draft ? ["Prepared on", dmy(todayIST())] : ["Salary Month", monthLabel(month)],
  ];
  for (let i = 0; i < 4; i++) {
    text(left[i][0], M, y, 8.5, font, muted); text(left[i][1], M + 105, y, 9.5, bold);
    text(rightCol[i][0], width / 2 + 10, y, 8.5, font, muted); text(rightCol[i][1], width / 2 + 110, y, 9.5);
    y -= 15;
  }
  y -= 4;
  // Days
  const total = Number(l.working_days) + Number(l.paid_offs) + Number(l.leaves);
  const days: [string, string][] = [
    ["Total days", `${total}`], ["Days worked", `${l.working_days}`], ["Weekly & paid offs", `${l.paid_offs}`], ["Leaves", `${l.leaves}`],
  ];
  if (Number(l.lop_days) > 0) days.push(["LOP days", `${l.lop_days}`]);
  if (!draft) {
    page.drawRectangle({ x: M, y: y - 11, width: width - 2 * M, height: 28, color: band });
    const colW = (width - 2 * M) / days.length;
    days.forEach(([k, v], i) => { text(k, M + 8 + i * colW, y + 4, 7.5, font, muted); text(v, M + 8 + i * colW, y - 4, 9.5, bold); });
    y -= 30;
  }

  // Two columns: earnings | employer contributions
  const c = l.calc || {};
  const earnings = formulas.filter((f) => f.category === "earning" && f.on_slip !== false);
  const employer = formulas.filter((f) => f.category === "employer" && f.on_slip !== false);
  const deductions = formulas.filter((f) => f.category === "deduction" && f.on_slip !== false);
  const L1 = M, R1 = width / 2 - 14, L2 = width / 2 + 10, R2 = width - M;
  const head = (t: string, x: number, xr: number, yy: number) => {
    page.drawRectangle({ x, y: yy - 5, width: xr - x, height: 17, color: band });
    text(t, x + 6, yy, 9, bold);
  };
  head("Salary", L1, R1, y); head("Other Salary Components (employer)", L2, R2, y); y -= 18;
  const rowsN = Math.max(earnings.length, employer.length);
  for (let i = 0; i < rowsN; i++) {
    const e = earnings[i], r = employer[i];
    if (e) { text(e.label, L1 + 6, y); right(fmt(c[e.key]), R1 - 6, y); }
    if (r) { text(r.label, L2 + 6, y); right(fmt(c[r.key]), R2 - 6, y); }
    y -= 14;
  }
  const empTotal = employer.reduce((a, f) => a + (Number(c[f.key]) || 0), 0);
  page.drawLine({ start: { x: L1, y: y + 9 }, end: { x: R1, y: y + 9 }, thickness: 0.6, color: line });
  page.drawLine({ start: { x: L2, y: y + 9 }, end: { x: R2, y: y + 9 }, thickness: 0.6, color: line });
  text("Gross Salary", L1 + 6, y - 2, 9.5, bold); right(fmt(c.gross), R1 - 6, y - 2, 9.5, bold);
  text("Total Other Salary Components", L2 + 6, y - 2, 9.5, bold); right(fmt(empTotal), R2 - 6, y - 2, 9.5, bold);
  y -= 28;

  // Deductions
  head("Employee Salary Deductions", L1, R1, y); y -= 18;
  for (const d of deductions) {
    const v = Number(c[d.key]) || 0;
    if (["professional_tax", "d_advance", "d_other"].includes(d.key) && v === 0) continue;
    text(d.label, L1 + 6, y); right(fmt(v), R1 - 6, y); y -= 14;
  }
  page.drawLine({ start: { x: L1, y: y + 9 }, end: { x: R1, y: y + 9 }, thickness: 0.6, color: line });
  text("Total Employee Deductions", L1 + 6, y - 2, 9.5, bold); right(fmt(c.total_deductions), R1 - 6, y - 2, 9.5, bold);
  y -= 16;
  if (Math.abs(Number(l.manual_adjustment) || 0) >= 0.5) {
    text((Number(l.manual_adjustment) > 0 ? "Other addition" : "Other adjustment") + (l.remarks ? ` (${l.remarks.slice(0, 30)})` : ""), L1 + 6, y - 2, 9.5);
    right((Number(l.manual_adjustment) > 0 ? "+" : "") + fmt(l.manual_adjustment), R1 - 6, y - 2, 9.5);
    y -= 16;
  }
  y -= 12;

  // Net
  page.drawRectangle({ x: M, y: y - 14, width: width - 2 * M, height: 34, color: rgb(0.11, 0.33, 0.45) });
  text(draft ? "Estimated In Hand Salary (per month)" : "Total In Hand Salary", M + 10, y + 2, 11, bold, rgb(1, 1, 1));
  const net = Number(l.net_pay) || 0;
  const netStr = `Rs. ${net.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  page.drawText(netStr, { x: width - M - 10 - bold.widthOfTextAtSize(netStr, 13), y: y + 1, size: 13, font: bold, color: rgb(1, 1, 1) });
  text(rupeesInWords(net), M + 10, y - 9, 8, font, rgb(0.85, 0.92, 0.96));
  y -= 44;

  // Notes
  text("Notes:", M, y, 8.5, bold, muted); y -= 12;
  const notes = draft
    ? ["This is a draft salary break-up for discussion only. It is not a payslip or an offer of employment.",
       "Actual monthly pay depends on attendance, statutory rates and rules in force at the time."]
    : (company.slip_notes || "").split("\n").filter(Boolean);
  for (const n of notes) { text(n, M, y, 8.5, font, muted); y -= 11; }
}

export async function buildSlipsPdf(company: Company, month: string, formulas: FormulaRow[], lines: LineRow[], mode: SlipMode = "final") {
  const doc = await PDFDocument.create();
  doc.setTitle(`${company.name} – Salary Slips ${monthLabel(month)}`);
  doc.setAuthor(company.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const l of lines) {
    const page = doc.addPage([595.28, 841.89]); // A4
    drawSlip(page, font, bold, company, month, formulas, l, mode);
  }
  return doc.save();
}

export type BreakupInfo = { name: string; designation?: string | null; location?: string | null; effectiveFrom?: string | null };

/**
 * One-page salary break-up: monthly and yearly, earnings → deductions → in-hand → company contributions → CTC.
 * "candidate" = proposed salary for someone who hasn't joined; "preview" = checking a revision for an employee.
 */
export async function buildBreakupPdf(company: Company, b: Breakup, info: BreakupInfo, mode: "candidate" | "preview") {
  const doc = await PDFDocument.create();
  const candidate = mode === "candidate";
  doc.setTitle(`${company.name} – ${candidate ? "Proposed salary" : "Salary preview"} – ${info.name}`);
  doc.setAuthor(company.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 56;
  const ink = rgb(0.1, 0.12, 0.15), muted = rgb(0.42, 0.45, 0.5), rule = rgb(0.85, 0.87, 0.9), brand = rgb(0.11, 0.33, 0.45), soft = rgb(0.95, 0.96, 0.98);
  page.drawText(candidate ? "DRAFT" : "PREVIEW", { x: 150, y: 300, size: 110, font: bold, color: rgb(0.94, 0.95, 0.97), rotate: degrees(35) });

  const text = (t: string, x: number, y: number, size = 10, f = font, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, y: number, size = 10, f = font, color = ink) =>
    text(t, xr - f.widthOfTextAtSize(safe(t), size), y, size, f, color);
  const money = (n: number) => fmt(n);

  // Header
  let y = height - M;
  text(company.name, M, y, 14, bold);
  right(candidate ? "Proposed Salary" : "Salary Preview", width - M, y, 14, bold, brand);
  y -= 14;
  if (company.address) text(company.address, M, y, 8, font, muted);
  right(`Prepared on ${dmy(todayIST())}`, width - M, y, 8, font, muted);
  y -= 22;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.8, color: rule });
  y -= 26;

  // Who
  text(info.name, M, y, 16, bold); y -= 16;
  text([info.designation, info.location].filter(Boolean).join("  ·  "), M, y, 10, font, muted); y -= 14;
  const basis = candidate
    ? `Monthly figures are for a full month. Yearly figures add up 12 months from ${monthLabel(b.month)}.`
    : `Revision effective ${dmy(info.effectiveFrom)}. Full month of ${monthLabel(b.month)}; yearly = 12 months from then.`;
  text(basis, M, y, 8.5, font, muted);
  y -= 30;

  // Table
  const C1 = width - M - 110, C2 = width - M; // right edges of the two amount columns
  right("Per month", C1, y, 8.5, bold, muted); right("Per year", C2, y, 8.5, bold, muted);
  y -= 8;
  const section = (title: string) => {
    y -= 14; text(title.toUpperCase(), M, y, 8.5, bold, brand); y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.6, color: rule }); y -= 15;
  };
  const line = (label: string, m: number, a: number) => {
    text(label, M + 4, y, 10); right(money(m), C1, y); right(money(a), C2, y, 10, font, muted); y -= 17;
  };
  const total = (label: string, m: number, a: number, fill = false) => {
    if (fill) page.drawRectangle({ x: M, y: y - 6, width: width - 2 * M, height: 21, color: soft });
    else page.drawLine({ start: { x: M, y: y + 12 }, end: { x: width - M, y: y + 12 }, thickness: 0.6, color: rule });
    text(label, M + 4, y, 10.5, bold); right(money(m), C1, y, 10.5, bold); right(money(a), C2, y, 10.5, bold); y -= 22;
  };

  section("Salary");
  for (const r of b.earnings) line(friendlyLabel(r), r.monthly, r.annual);
  total("Gross salary", b.gross.monthly, b.gross.annual);

  if (b.deductions.length) {
    section("Deducted from salary");
    for (const r of b.deductions) line(friendlyLabel(r), r.monthly, r.annual);
    total("Total deductions", b.deductionsTotal.monthly, b.deductionsTotal.annual);
  }

  // In hand
  y -= 8;
  page.drawRectangle({ x: M, y: y - 16, width: width - 2 * M, height: 38, color: brand });
  const white = rgb(1, 1, 1);
  text(candidate ? "In-hand salary (estimated)" : "In-hand salary", M + 12, y + 2, 12, bold, white);
  text(rupeesInWords(b.net.monthly) + " per month", M + 12, y - 10, 7.5, font, rgb(0.85, 0.92, 0.96));
  right(`Rs. ${money(b.net.monthly)}`, C1, y - 2, 12, bold, white);
  right(`Rs. ${money(b.net.annual)}`, C2, y - 2, 12, bold, white);
  y -= 40;

  if (b.employer.length) {
    section("Paid by the company on top of salary");
    for (const r of b.employer) line(friendlyLabel(r), r.monthly, r.annual);
  }
  y -= 4;
  total("Cost to company (CTC)", b.ctc.monthly, b.ctc.annual, true);

  // Notes
  y -= 16;
  const notes = candidate
    ? ["This is a proposed salary break-up for discussion. It is not a payslip or an offer of employment.",
       "Actual pay depends on attendance and the statutory rates in force each month.",
       ...(b.employer.some((r) => r.key === "bonus" || r.key === "gratuity") ? ["Bonus and gratuity are set aside by the company each month and paid as per rules, not with salary."] : [])]
    : ["Preview for checking a salary revision. It is not a payslip.",
       "The monthly payroll applies attendance, overtime and other inputs on top of these figures."];
  for (const n of notes) { text(n, M, y, 8, font, muted); y -= 11; }

  return doc.save();
}

export const slipFilename =(month: string, name?: string) =>
  name ? `Spans ${monthLabel(month)} Salary Slip - ${name.replace(/[^\w .-]/g, "")}.pdf` : `Spans ${monthLabel(month)} Salary Slips.pdf`;
