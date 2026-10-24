// Salary slip PDF – same layout as the "FY2026-27-Salary Slips" tab, generated server-side with pdf-lib.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { monthLabel, type FormulaRow } from "./payroll";
import type { LineRow } from "./exports";

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

function drawSlip(page: PDFPage, font: PDFFont, bold: PDFFont, company: Company, month: string, formulas: FormulaRow[], l: LineRow) {
  const { width, height } = page.getSize();
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
  right("SALARY SLIP", width - M, height - M, 11, bold);
  right(monthLabel(month), width - M, height - M - 14, 10);
  y -= 12; hr(y); y -= 20;

  // Employee block
  const s = l.snapshot;
  const left: [string, string][] = [
    ["Name of Employee", s.name], ["Employee #", s.emp_code], ["Designation", s.designation || ""], ["Location", s.location || ""],
  ];
  const rightCol: [string, string][] = [
    ["UAN", s.uan || "Not applicable"], ["Date of Joining", dmy(s.date_of_joining)],
    ["Bank A/c", s.bank_account ? `XXXX${s.bank_account.replace(/\s/g, "").slice(-4)}` : ""], ["Salary Month", monthLabel(month)],
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
  page.drawRectangle({ x: M, y: y - 11, width: width - 2 * M, height: 28, color: band });
  const colW = (width - 2 * M) / days.length;
  days.forEach(([k, v], i) => { text(k, M + 8 + i * colW, y + 4, 7.5, font, muted); text(v, M + 8 + i * colW, y - 4, 9.5, bold); });
  y -= 30;

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
    if (d.key === "professional_tax" && v === 0) continue;
    text(d.label, L1 + 6, y); right(fmt(v), R1 - 6, y); y -= 14;
  }
  page.drawLine({ start: { x: L1, y: y + 9 }, end: { x: R1, y: y + 9 }, thickness: 0.6, color: line });
  text("Total Employee Deductions", L1 + 6, y - 2, 9.5, bold); right(fmt(c.total_deductions), R1 - 6, y - 2, 9.5, bold);
  y -= 16;
  if (Math.abs(Number(l.manual_adjustment) || 0) >= 0.5) {
    text("Adjustment" + (l.remarks ? ` (${l.remarks.slice(0, 30)})` : ""), L1 + 6, y - 2, 9.5);
    right((Number(l.manual_adjustment) > 0 ? "+" : "") + fmt(l.manual_adjustment), R1 - 6, y - 2, 9.5);
    y -= 16;
  }
  y -= 12;

  // Net
  page.drawRectangle({ x: M, y: y - 14, width: width - 2 * M, height: 34, color: rgb(0.11, 0.33, 0.45) });
  text("Total In Hand Salary", M + 10, y + 2, 11, bold, rgb(1, 1, 1));
  const net = Number(l.net_pay) || 0;
  const netStr = `Rs. ${net.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  page.drawText(netStr, { x: width - M - 10 - bold.widthOfTextAtSize(netStr, 13), y: y + 1, size: 13, font: bold, color: rgb(1, 1, 1) });
  text(rupeesInWords(net), M + 10, y - 9, 8, font, rgb(0.85, 0.92, 0.96));
  y -= 44;

  // Notes
  text("Notes:", M, y, 8.5, bold, muted); y -= 12;
  for (const n of (company.slip_notes || "").split("\n").filter(Boolean)) { text(n, M, y, 8.5, font, muted); y -= 11; }
}

export async function buildSlipsPdf(company: Company, month: string, formulas: FormulaRow[], lines: LineRow[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${company.name} – Salary Slips ${monthLabel(month)}`);
  doc.setAuthor(company.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const l of lines) {
    const page = doc.addPage([595.28, 841.89]); // A4
    drawSlip(page, font, bold, company, month, formulas, l);
  }
  return doc.save();
}

export const slipFilename = (month: string, name?: string) =>
  name ? `Spans ${monthLabel(month)} Salary Slip - ${name.replace(/[^\w .-]/g, "")}.pdf` : `Spans ${monthLabel(month)} Salary Slips.pdf`;
