import { apiDb, download } from "@/lib/api";
import { buildSlipsPdf, slipFilename, type Company } from "@/lib/slip-pdf";
import type { LineRow } from "@/lib/exports";
import type { FormulaRow } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await apiDb();
  if ("error" in g) return g.error;
  const { data: line } = await g.sb.from("payroll_lines").select("*, payroll_runs(month, formulas, status)").eq("id", params.id).single();
  if (!line) return new Response("Not found", { status: 404 });
  if (line.error) return new Response(`Can't make a slip: ${line.error}`, { status: 400 });
  const { data: company } = await g.sb.from("company_settings").select("*").eq("id", 1).single();
  const run = line.payroll_runs as { month: string; formulas: FormulaRow[]; status: string };
  const pdf = await buildSlipsPdf(company as Company, run.month, run.formulas, [line as LineRow], run.status === "finalized" ? "final" : "provisional");
  return download(Buffer.from(pdf), slipFilename(run.month, (line as LineRow).snapshot.name), "application/pdf");
}
