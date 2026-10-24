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

  switch (params.kind) {
    case "hdfc": {
      const r = hdfcCsv(run, ok);
      return download(r.csv, r.filename, "text/csv; charset=utf-8");
    }
    case "orgzit": {
      const r = orgzitCsv(run, ok, company.orgzit);
      return download(r.csv, r.filename, "text/csv; charset=utf-8");
    }
    case "register": {
      const r = registerCsv(run, lines);
      return download("﻿" + r.csv, r.filename, "text/csv; charset=utf-8");
    }
    case "slips": {
      const pdf = await buildSlipsPdf(company, run.month, run.formulas, ok);
      return download(Buffer.from(pdf), slipFilename(run.month), "application/pdf");
    }
    case "slips-zip": {
      const zip = new JSZip();
      for (const l of ok) {
        const pdf = await buildSlipsPdf(company, run.month, run.formulas, [l]);
        zip.file(`${l.print_code} ${slipFilename(run.month, l.snapshot.name)}`, pdf);
      }
      const buf = await zip.generateAsync({ type: "nodebuffer" });
      return download(buf, `Spans ${monthLabel(run.month)} Salary Slips.zip`, "application/zip");
    }
  }
  return new Response("Unknown export", { status: 404 });
}
