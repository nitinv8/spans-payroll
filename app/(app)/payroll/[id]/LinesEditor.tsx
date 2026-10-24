"use client";

import { Fragment, useState, useTransition } from "react";
import { saveLine } from "@/app/actions";
import { inr, CATEGORY_LABEL, type FormulaRow, type Category } from "@/lib/payroll";
import type { LineRow } from "@/lib/exports";

const INPUTS = [
  ["working_days", "Worked", false], ["paid_offs", "Offs", false], ["leaves", "Leaves", false], ["lop_days", "LOP", false],
  ["incentive", "Incentive", true], ["arrears", "Arrears", true], ["ex_gratia", "Ex-gratia", true],
  ["manual_adjustment", "Adjust ±", true], ["professional_tax", "PT", true],
] as const;
type InputKey = (typeof INPUTS)[number][0];

export default function LinesEditor({ lines: initial, formulas, locked, month, runId, removeAction }: {
  lines: LineRow[]; formulas: FormulaRow[]; locked: boolean; month: string; runId: string; removeAction: (f: FormData) => Promise<void>;
}) {
  const [lines, setLines] = useState(initial);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [, start] = useTransition();

  const set = (id: string, k: InputKey | "remarks", v: string) => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, [k]: k === "remarks" ? v : (v as unknown as number) } : l)));
    setDirty((d) => ({ ...d, [id]: true }));
  };

  const save = (id: string) => {
    if (!dirty[id]) return;
    const l = lines.find((x) => x.id === id)!;
    setStatus((s) => ({ ...s, [id]: "Saving…" }));
    start(async () => {
      const res = await saveLine(id, {
        working_days: +l.working_days, paid_offs: +l.paid_offs, leaves: +l.leaves, lop_days: +l.lop_days, incentive: +l.incentive,
        arrears: +l.arrears, ex_gratia: +l.ex_gratia, manual_adjustment: +l.manual_adjustment, professional_tax: +l.professional_tax,
        remarks: l.remarks ?? null,
      });
      if ("error" in res && res.error) { setStatus((s) => ({ ...s, [id]: res.error! })); return; }
      if ("line" in res && res.line) setLines((ls) => ls.map((x) => (x.id === id ? (res.line as LineRow) : x)));
      setDirty((d) => ({ ...d, [id]: false }));
      setStatus((s) => ({ ...s, [id]: "Saved" }));
      setTimeout(() => setStatus((s) => ({ ...s, [id]: "" })), 1500);
    });
  };

  const total = (k: string) => lines.reduce((a, l) => a + (Number(k in l ? (l as any)[k] : l.calc?.[k]) || 0), 0);
  const groups = (["earning", "deduction", "employer", "total", "working", "parameter"] as Category[])
    .map((c) => [c, formulas.filter((f) => f.category === c)] as const).filter(([, fs]) => fs.length);

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Employee</th>
            {INPUTS.map(([k, l]) => <th key={k} className="num">{l}</th>)}
            <th className="num">Gross</th><th className="num">Deductions</th><th className="num">In hand</th><th className="num">CTC</th><th></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const total = Number(l.working_days) + Number(l.paid_offs) + Number(l.leaves);
            return (
              <Fragment key={l.id}>
                <tr onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) save(l.id); }}>
                  <td className="mono">{l.print_code}</td>
                  <td>
                    <div><b>{l.snapshot.name}</b></div>
                    <div className="muted small">{l.snapshot.designation} · {l.snapshot.location} · {total} days</div>
                    {l.error && <div className="small" style={{ color: "var(--bad)" }}>{l.error}</div>}
                    {status[l.id] && <div className="small muted">{status[l.id]}</div>}
                  </td>
                  {INPUTS.map(([k, , money]) => (
                    <td key={k} className="num">
                      {locked ? inr(Number(l[k])) || "-" : (
                        <input className={`grid-input${money ? " wide" : ""}`} type="number" step={money ? "1" : "0.5"} value={String(l[k] ?? 0)}
                          onChange={(e) => set(l.id, k, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(l.id); }} aria-label={`${k} for ${l.snapshot.name}`} />
                      )}
                    </td>
                  ))}
                  <td className="num">{inr(l.gross)}</td>
                  <td className="num">{inr(l.calc?.total_deductions)}</td>
                  <td className="num"><b>{inr(l.net_pay)}</b></td>
                  <td className="num">{inr(l.ctc)}</td>
                  <td>
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <button type="button" className="btn sm" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? "Hide" : "Details"}</button>
                      <a className="btn sm" href={`/api/lines/${l.id}/slip`}>Slip</a>
                    </div>
                  </td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td></td>
                    <td colSpan={INPUTS.length + 6} style={{ whiteSpace: "normal", background: "#fafbfc" }}>
                      <div className="grid3" style={{ gap: 18 }}>
                        {groups.filter(([c]) => c !== "parameter").map(([c, fs]) => (
                          <div key={c}>
                            <h3>{CATEGORY_LABEL[c]}</h3>
                            <table><tbody>
                              {fs.map((f) => <tr key={f.key}><td className="small">{f.label}</td><td className="num small">{inr(l.calc?.[f.key], 2)}</td></tr>)}
                            </tbody></table>
                          </div>
                        ))}
                        <div>
                          <h3>Salary structure used</h3>
                          <table><tbody>
                            {Object.entries((l as any).structure || {}).filter(([k]) => k !== "extras").map(([k, v]) => (
                              <tr key={k}><td className="small">{k}</td><td className="num small">{typeof v === "boolean" ? (v ? "Yes" : "No") : inr(v as number)}</td></tr>
                            ))}
                          </tbody></table>
                          <div style={{ marginTop: 10 }}>
                            <label htmlFor={`rm-${l.id}`}>Remarks (shown on slip next to adjustment)</label>
                            {locked ? <div>{l.remarks || "–"}</div> : (
                              <input id={`rm-${l.id}`} value={l.remarks || ""} onChange={(e) => set(l.id, "remarks", e.target.value)} onBlur={() => save(l.id)} />
                            )}
                          </div>
                          {!locked && (
                            <form action={removeAction} style={{ marginTop: 10 }}>
                              <input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="run_id" value={runId} />
                              <button className="btn sm danger" onClick={(e) => { if (!confirm(`Remove ${l.snapshot.name} from ${month.slice(0, 7)} payroll?`)) e.preventDefault(); }}>
                                Remove from this month
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td></td><td>Total</td>
            {INPUTS.map(([k, , money]) => <td key={k} className="num">{money ? inr(total(k)) : ""}</td>)}
            <td className="num">{inr(total("gross"))}</td><td className="num">{inr(total("total_deductions"))}</td>
            <td className="num">{inr(total("net_pay"))}</td><td className="num">{inr(total("ctc"))}</td><td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
