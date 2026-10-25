"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { saveLine } from "@/app/actions";
import { inr, daysInMonth, CATEGORY_LABEL, type FormulaRow, type Category } from "@/lib/payroll";
import type { LineRow } from "@/lib/exports";
import type { Contact } from "@/components/SendSlip";
import RowMenu from "@/components/RowMenu";

// [key, column label, money?, human label, needs formula input name (column hidden if this month's formulas don't use it)]
const ALL_INPUTS = [
  ["working_days", "Worked", false, "Days worked", ""], ["paid_offs", "Offs", false, "Weekly and paid offs", ""],
  ["leaves", "Paid leave", false, "Paid leave days", ""], ["lop_days", "LOP", false, "Unpaid leave (loss of pay) days", ""],
  ["incentive", "Incentive / OT", true, "Incentive or OT amount", ""], ["arrears", "Arrears", true, "Arrears", ""],
  ["ex_gratia", "Ex-gratia", true, "Ex-gratia", ""],
  ["advance_recovery", "Advance rec.", true, "Advance or loan recovery", "advance_recovery"],
  ["other_deduction", "Other ded.", true, "Other deduction (give reason in remarks)", "other_deduction"],
  ["manual_adjustment", "Other add. ±", true, "Other addition after statutory deductions (give reason in remarks)", ""],
  ["professional_tax", "PT (manual)", true, "Professional tax entered manually, on top of automatic PT", ""],
] as const;
type InputKey = (typeof ALL_INPUTS)[number][0];

export default function LinesEditor({ lines: initial, formulas, locked, month, runId, removeAction, contacts }: {
  lines: LineRow[]; formulas: FormulaRow[]; locked: boolean; month: string; runId: string; removeAction: (f: FormData) => Promise<void>;
  contacts: Record<string, Contact>;
}) {
  const [lines, setLines] = useState(initial);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const dim = daysInMonth(month);
  // Only show input columns this month's formulas actually use
  const INPUTS = useMemo(() => {
    const used = formulas.map((f) => f.expr).join(" ");
    return ALL_INPUTS.filter(([, , , , need]) => !need || new RegExp(`\\b${need}\\b`).test(used));
  }, [formulas]);
  // When the server sends fresh rows (after a save or recalculation), keep any row still being edited
  useEffect(() => {
    setLines((cur) => initial.map((srv) => {
      const mine = cur.find((c) => c.id === srv.id);
      return mine && dirty[srv.id] ? mine : srv;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  // Warn before leaving the page with unsaved edits
  useEffect(() => {
    const anyDirty = Object.values(dirty).some(Boolean);
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
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
        advance_recovery: +(l.advance_recovery ?? 0), other_deduction: +(l.other_deduction ?? 0),
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
            <th aria-label="Actions" style={{ width: 36 }}></th><th>#</th><th>Employee</th>
            {INPUTS.map(([k, l, , full]) => <th key={k} className="num" title={full}>{l}</th>)}
            <th className="num">Gross</th><th className="num">Deductions</th><th className="num">In hand</th><th className="num">CTC</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const total = Number(l.working_days) + Number(l.paid_offs) + Number(l.leaves) + Number(l.lop_days);
            const daysOff = total !== dim && total !== 0; // worked + offs + leave + LOP should equal calendar days
            const needsReason = !l.remarks && (Number(l.other_deduction ?? 0) !== 0 || Number(l.manual_adjustment) !== 0);
            return (
              <Fragment key={l.id}>
                <tr onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) save(l.id); }}>
                  <td className="menu-cell">
                    <RowMenu target={{ lineId: l.id, name: l.snapshot.name, month, netPay: l.net_pay,
                        contact: contacts[(l as LineRow & { employee_id: string }).employee_id] || { email: null, mobile: null } }}
                      disabled={!!l.error} detailsOpen={open === l.id} onToggleDetails={() => setOpen(open === l.id ? null : l.id)}
                      onNote={(msg) => setStatus((s) => (s[l.id] === msg ? s : { ...s, [l.id]: msg }))} />
                  </td>
                  <td className="mono">{l.print_code}</td>
                  <td>
                    <button type="button" className="namelink" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}
                      title={open === l.id ? "Hide details" : "Show details"}>{l.snapshot.name}</button>
                    <div className="muted small">{l.snapshot.designation} · {l.snapshot.location} ·{" "}
                      {daysOff ? <span className="badge warn" title={`Worked + offs + leave + LOP should add up to ${dim}`}>{total} of {dim} days</span> : `${total} days`}</div>
                    {needsReason && <div className="small" style={{ color: "var(--warn)" }}>Add a reason in remarks (View details) for the deduction/addition.</div>}
                    {l.error && <div className="small" style={{ color: "var(--bad)" }}>{l.error}</div>}
                    {status[l.id] && <div className="small muted">{status[l.id]}</div>}
                  </td>
                  {INPUTS.map(([k, , money, full]) => (
                    <td key={k} className="num">
                      {locked ? inr(Number(l[k])) || "-" : (
                        <input className={`grid-input${money ? " wide" : ""}`} type="number" step={money ? "1" : "0.5"} value={String(l[k] ?? 0)}
                          min={k === "manual_adjustment" ? undefined : 0} max={money ? undefined : dim}
                          onChange={(e) => set(l.id, k, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(l.id); }}
                          aria-label={`${full} for ${l.snapshot.name}`} title={full} />
                      )}
                    </td>
                  ))}
                  <td className="num">{inr(l.gross)}</td>
                  <td className="num">{inr(l.calc?.total_deductions)}</td>
                  <td className="num"><b>{inr(l.net_pay)}</b></td>
                  <td className="num">{inr(l.ctc)}</td>
                </tr>
                {open === l.id && (
                  <tr>
                    <td></td>
                    <td colSpan={INPUTS.length + 6} style={{ whiteSpace: "normal", background: "#fafbfc" }}>
                      <div className="grid3 details-panel" style={{ gap: 18 }}>
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
            <td></td><td></td><td>Total</td>
            {INPUTS.map(([k, , money]) => <td key={k} className="num">{money ? inr(total(k)) : ""}</td>)}
            <td className="num">{inr(total("gross"))}</td><td className="num">{inr(total("total_deductions"))}</td>
            <td className="num">{inr(total("net_pay"))}</td><td className="num">{inr(total("ctc"))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
