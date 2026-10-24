import { supabaseServer } from "@/lib/supabase/server";
import type { FormulaRow } from "@/lib/payroll";
import type { LineRow, RunRow, OrgzitSettings } from "@/lib/exports";
import type { Company } from "@/lib/slip-pdf";

export async function apiDb() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: new Response("Not signed in", { status: 401 }) } as const;
  const { data } = await sb.from("app_users").select("email").limit(1);
  if (!data?.length) return { error: new Response("Not allowed", { status: 403 }) } as const;
  return { sb } as const;
}

export async function loadRunWithLines(sb: ReturnType<typeof supabaseServer>, runId: string) {
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", runId).single();
  if (!run) return null;
  const { data: lines } = await sb.from("payroll_lines").select("*").eq("run_id", runId);
  const sorted = ((lines || []) as LineRow[]).sort((a, b) => Number(a.print_code?.slice(1)) - Number(b.print_code?.slice(1)));
  const { data: company } = await sb.from("company_settings").select("*").eq("id", 1).single();
  return { run: { ...run, formulas: run.formulas as FormulaRow[] } as RunRow, lines: sorted, company: company as Company & { orgzit: OrgzitSettings } };
}

export function download(body: BodyInit, filename: string, type: string) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
