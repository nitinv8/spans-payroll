import JSZip from "jszip";
import { apiDb, loadRunWithLines, download } from "@/lib/api";
import { hdfcCsv, orgzitCsv, registerCsv } from "@/lib/exports";
import { buildSlipsPdf, slipFilename } from "@/lib/slip-pdf";
import { monthLabel } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string; kind: string } }) {
  const g = await apiDb();
  if ("error" in g) return g.error;
  const data = await loadRunWithLines(g.sb, params.id);
  if (!data) return new Response("Not found", { status: 404 });
  const { run, lines, company } = data;
  const ok = lines.filter((l) => !l.error);
  const finalized = run.status === "finalized";
  const mode = finalized ? "final" : "provisional";
  const log = async (kind: string, rows: number, total: number) => {
    const { data: { user } } = await g.sb.auth.getUser();
    await g.sb.from("export_log").insert({ run_id: run.id, kind, rows, total, actor: user?.email ?? null });
  };
  const blocked = (what: string) => new Response(
    `${what} can only be downloaded after the month is finalized, so the amounts can't change afterwards. Finalize the month first, then download again.`,
    { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });

  switch (params.kind) {
    case "hdfc": {
      if (!finalized) return blocked("The HDFC bank file");
      const r = hdfcCsv(run, ok);
      await log("hdfc", r.count, r.total);
      return download(r.csv, r.filename, "text/csv; charset=utf-8");
    }
    case "orgzit": {
      if (!finalized) return blocked("The Orgzit upload file");
      const r = orgzitCsv(run, ok, company.orgzit);
      await log("orgzit", r.count, r.total);
      return download(r.csv, r.filename, "text/csv; charset=utf-8");
    }
    case "register": {
      const r = registerCsv(run, lines);
      await log("register", lines.length, lines.reduce((a, l) => a + (Number(l.net_pay) || 0), 0));
      return download("\uFEFF" + r.csv, r.filename, "text/csv; charset=utf-8");
    }
    case "slips": {
      const pdf = await buildSlipsPdf(company, run.month, run.formulas, ok, mode);
      await log("slips", ok.length, 0);
      return download(Buffer.from(pdf), (finalized ? "" : "PROVISIONAL ") + slipFilename(run.month), "application/pdf");
    }
    case "slips-zip": {
      const zip = new JSZip();
      for (const l of ok) {
        const pdf = await buildSlipsPdf(company, run.month, run.formulas, [l], mode);
        zip.file(`${l.print_code} ${slipFilename(run.month, l.snapshot.name)}`, pdf);
      }
      const buf = await zip.generateAsync({ type: "nodebuffer" });
      await log("slips", ok.length, 0);
      return download(buf, `${finalized ? "" : "PROVISIONAL "}Spans ${monthLabel(run.month)} Salary Slips.zip`, "application/zip");
    }
  }
  return new Response("Unknown export", { status: 404 });
}
