// Draft salary break-up for a prospective / draft employee, computed from their latest salary structure
// with the formulas in force for the current month and a full month of attendance. Nothing is saved.
import { apiDb, download } from "@/lib/api";
import { buildSlipsPdf, type Company } from "@/lib/slip-pdf";
import { DEFAULT_FORMULAS, daysInMonth, monthEnd, thisMonthIST, type FormulaRow } from "@/lib/payroll";
import { computeLine, snapshotOf, structureValues, type Employee, type Structure } from "@/lib/run-logic";
import type { LineRow } from "@/lib/exports";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await apiDb();
  if ("error" in g) return g.error;
  const { data: e } = await g.sb.from("employees").select("*").eq("id", params.id).single();
  if (!e) return new Response("Employee not found", { status: 404 });
  const { data: structs } = await g.sb.from("salary_structures").select("*").eq("employee_id", e.id).order("effective_from", { ascending: false }).limit(1);
  const s = structs?.[0] as Structure | undefined;
  if (!s) return new Response("Add a salary structure for this person first (Salary history tab).", { status: 400 });

  const month = thisMonthIST();
  const { data: sets } = await g.sb.from("formula_sets").select("formulas").lte("effective_from", monthEnd(month)).order("effective_from", { ascending: false }).limit(1);
  const formulas = (sets?.[0]?.formulas as FormulaRow[]) || DEFAULT_FORMULAS;

  const dim = daysInMonth(month);
  const inputs = { working_days: dim, paid_offs: 0, leaves: 0, lop_days: 0, incentive: 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0 };
  const snap = snapshotOf(e as Employee);
  const r = computeLine(formulas, month, snap, structureValues(s), inputs);
  if (r.error) return new Response(r.error, { status: 400 });
  const line = { id: "draft", print_code: null, snapshot: snap, ...inputs, ...r, calc: r.calc as Record<string, number>, remarks: null } as LineRow;

  const { data: company } = await g.sb.from("company_settings").select("*").eq("id", 1).single();
  const pdf = await buildSlipsPdf(company as Company, month, formulas, [line], true);
  return download(Buffer.from(pdf), `Spans Draft Salary Break-up - ${e.name.replace(/[^\w .-]/g, "")}.pdf`, "application/pdf");
}
