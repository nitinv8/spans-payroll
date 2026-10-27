// Salary break-up PDF for one salary revision (default: the latest), with the formulas in force in the month it is
// first paid and a full month of attendance. Draft employees get the "Proposed salary" version for candidates;
// everyone else gets a "Salary preview" for checking a revision. Nothing is saved.
import { apiDb, download } from "@/lib/api";
import { buildBreakupPdf, type Company } from "@/lib/slip-pdf";
import { DEFAULT_FORMULAS, thisMonthIST } from "@/lib/payroll";
import { formulasForMonth, previewMonth, salaryBreakup } from "@/lib/breakup";
import { snapshotOf, structureValues, type Employee, type Structure } from "@/lib/run-logic";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await apiDb();
  if ("error" in g) return g.error;
  const structureId = new URL(req.url).searchParams.get("structure");
  const [{ data: e }, { data: structs }, { data: sets }, { data: company }] = await Promise.all([
    g.sb.from("employees").select("*").eq("id", params.id).single(),
    g.sb.from("salary_structures").select("*").eq("employee_id", params.id).order("effective_from", { ascending: false }),
    g.sb.from("formula_sets").select("effective_from, formulas"),
    g.sb.from("company_settings").select("*").eq("id", 1).single(),
  ]);
  if (!e) return new Response("Employee not found", { status: 404 });
  const s = (structureId ? structs?.find((x) => x.id === structureId) : structs?.[0]) as Structure | undefined;
  if (!s) return new Response("Add a salary structure for this person first (Salary history tab).", { status: 400 });

  const month = previewMonth(s.effective_from, thisMonthIST());
  const formulas = formulasForMonth(sets, month, DEFAULT_FORMULAS);
  const b = salaryBreakup(formulas, month, snapshotOf(e as Employee), structureValues(s));
  if (b.error) return new Response(b.error, { status: 400 });

  const candidate = e.status === "Draft";
  const pdf = await buildBreakupPdf(company as Company, b,
    { name: e.name, designation: e.designation, location: e.location, effectiveFrom: s.effective_from }, candidate ? "candidate" : "preview");
  const who = e.name.replace(/[^\w .-]/g, "");
  return download(Buffer.from(pdf), candidate ? `Spans Proposed Salary - ${who}.pdf` : `Spans Salary Preview - ${who} - from ${s.effective_from}.pdf`, "application/pdf");
}
