// Staff app: one finalized payslip PDF for the signed-in employee (the database refuses anyone else's).
import { supabaseServer } from "@/lib/supabase/server";
import { download } from "@/lib/api";
import { buildSlipsPdf, slipFilename, type Company } from "@/lib/slip-pdf";
import type { FormulaRow } from "@/lib/payroll";
import type { LineRow } from "@/lib/exports";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("my_payslip", { p_line: params.id });
  if (error || !data) return new Response("Payslip not found", { status: 404 });
  const { line, run, company } = data as { line: LineRow; run: { month: string; formulas: FormulaRow[] }; company: Company };
  const pdf = await buildSlipsPdf(company, run.month, run.formulas, [line], "final");
  return download(Buffer.from(pdf), slipFilename(run.month, line.snapshot.name), "application/pdf");
}
