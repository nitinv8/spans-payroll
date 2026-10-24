"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parse, evalNode, FUNCTION_HELP, type Ctx } from "@/lib/formula";
import {
  buildContext, validateFormulas, INPUT_VARIABLES, CATEGORY_LABEL, REQUIRED_KEYS,
  type FormulaRow, type Category, type StructureFields,
} from "@/lib/payroll";
import { saveFormulaSet } from "@/app/actions";

type Sample = { id: string; name: string; location: string; designation: string; date_of_joining: string | null; active: boolean; structure: StructureFields };
const CATS: Category[] = ["parameter", "working", "earning", "deduction", "employer", "total"];

export default function FormulaEditor({ id, effectiveFrom, name, notes, initial, defaults, samples, usedBy }: {
  id: string | null; effectiveFrom: string; name: string; notes: string; initial: FormulaRow[]; defaults: FormulaRow[];
  samples: Sample[]; usedBy: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<FormulaRow[]>(initial);
  const [eff, setEff] = useState(effectiveFrom.slice(0, 7));
  const [nm, setNm] = useState(name);
  const [nt, setNt] = useState(notes);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const firstActive = samples.find((s) => s.active) || samples[0];
  const [sampleId, setSampleId] = useState(firstActive?.id || "");
  const [m, setM] = useState({ working_days: 26, paid_offs: 4, leaves: 0, lop_days: 0, incentive: 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0 });

  const sample = samples.find((s) => s.id === sampleId);
  const extraNames = useMemo(() => Array.from(new Set(samples.flatMap((s) => Object.keys(s.structure.extras || {})))), [samples]);

  // Live evaluation, row by row, so each formula shows its value or its own error
  const preview = useMemo(() => {
    const out: Record<string, { v?: number | string; err?: string }> = {};
    if (!sample) return out;
    const ctx: Ctx = buildContext(sample.structure, { month: `${eff}-01`, ...m }, sample);
    for (const n of extraNames) if (!(n in ctx)) ctx[n] = 0;
    for (const r of rows) {
      try { const v = evalNode(parse(r.expr), ctx); ctx[r.key] = v; out[r.key] = { v }; }
      catch (e) { out[r.key] = { err: (e as Error).message }; ctx[r.key] = 0; }
    }
    return out;
  }, [rows, sample, m, eff, extraNames]);

  const update = (i: number, patch: Partial<FormulaRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => {
    const j = i + d; if (j < 0 || j >= rs.length) return rs;
    const c = [...rs]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const remove = (i: number) => {
    const k = rows[i].key;
    if ((REQUIRED_KEYS as readonly string[]).includes(k)) return alert(`"${k}" is required by the app (slips, bank file, reports). Change its formula instead of deleting it.`);
    setRows((rs) => rs.filter((_, j) => j !== i));
  };
  const addAfterLast = (cat: Category) => setRows((rs) => {
    const idx = rs.map((r) => r.category).lastIndexOf(cat);
    const row: FormulaRow = { key: `new_${cat}_${rs.length}`, label: "New item", expr: "0", category: cat, on_slip: cat === "earning" || cat === "deduction" || cat === "employer" };
    // Earnings need to be added into "gross" to count; deductions into "total_deductions"
    const c = [...rs]; c.splice(idx >= 0 ? idx + 1 : c.length, 0, row); return c;
  });

  const save = () => {
    const errs = validateFormulas(rows, extraNames);
    setErrors(errs); setMsg("");
    if (errs.length) return;
    start(async () => {
      const res = await saveFormulaSet({ id, effective_from: `${eff}-01`, name: nm, notes: nt, formulas: rows });
      if (!res.ok) return setErrors(res.errors);
      setMsg("Saved. Draft payroll months pick this up when you click “Re-calculate with latest data”. Finalized months are not changed.");
      router.replace(`/settings/formulas?set=${res.id}`);
      router.refresh();
    });
  };

  const fmt = (v: number | string | undefined) => typeof v === "number" ? (Math.abs(v) < 1 && v !== 0 ? v.toFixed(4).replace(/0+$/, "") : v.toLocaleString("en-IN", { maximumFractionDigits: 2 })) : String(v ?? "");

  return (
    <>
      <div className="panel">
        <div className="fields">
          <div><label htmlFor="f-eff">Applies to payroll months from</label><input id="f-eff" type="month" value={eff} onChange={(e) => setEff(e.target.value)} /></div>
          <div className="wide"><label htmlFor="f-name">Name</label><input id="f-name" value={nm} onChange={(e) => setNm(e.target.value)} /></div>
          <div className="wide"><label htmlFor="f-notes">Notes (what changed and why)</label><input id="f-notes" value={nt} onChange={(e) => setNt(e.target.value)} /></div>
        </div>
        {usedBy.length > 0 && <p className="small muted" style={{ marginBottom: 0 }}>Used by payroll months: {usedBy.join(", ")}. Each month keeps its own copy, so editing here only changes draft months, and only after you re-calculate them.</p>}
      </div>

      <div className="grid2" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <div>
          {CATS.map((cat) => {
            const list = rows.map((r, i) => [r, i] as const).filter(([r]) => r.category === cat);
            return (
              <div className="panel" key={cat}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>{CATEGORY_LABEL[cat]}</h2>
                  <button type="button" className="btn sm" onClick={() => addAfterLast(cat)}>+ Add</button>
                </div>
                <div className="frow small muted" style={{ borderBottom: "1px solid var(--line)" }}>
                  <div>Name (used in formulas)</div><div>Label (slip / reports)</div><div>Formula</div><div style={{ textAlign: "right" }}>Preview</div><div></div>
                </div>
                {list.map(([r, i]) => (
                  <div className="frow" key={i}>
                    <input className="mono" value={r.key} onChange={(e) => update(i, { key: e.target.value.replace(/\s/g, "_") })} aria-label="Name" />
                    <div>
                      <input value={r.label} onChange={(e) => update(i, { label: e.target.value })} aria-label="Label" />
                      <div className="row small" style={{ marginTop: 4, gap: 10 }}>
                        <select value={r.category} onChange={(e) => update(i, { category: e.target.value as Category })} style={{ padding: "2px 4px", width: "auto", fontSize: 12 }}>
                          {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                        </select>
                        {["earning", "deduction", "employer"].includes(r.category) && (
                          <label className="check small"><input type="checkbox" checked={r.on_slip !== false} onChange={(e) => update(i, { on_slip: e.target.checked })} /> on slip</label>
                        )}
                      </div>
                    </div>
                    <textarea rows={Math.min(4, Math.max(1, Math.ceil(r.expr.length / 60)))} value={r.expr} onChange={(e) => update(i, { expr: e.target.value })} aria-label="Formula" spellCheck={false} />
                    <div className="val" title={preview[r.key]?.err}>{preview[r.key]?.err ? <span style={{ color: "var(--bad)" }}>error</span> : fmt(preview[r.key]?.v)}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button type="button" className="btn sm" title="Move up" onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="btn sm" title="Move down" onClick={() => move(i, 1)}>↓</button>
                      <button type="button" className="btn sm danger" title="Delete" onClick={() => remove(i)}>×</button>
                    </div>
                    {preview[r.key]?.err && <div className="ferr">{preview[r.key]?.err}</div>}
                  </div>
                ))}
                {!list.length && <p className="muted small">None.</p>}
              </div>
            );
          })}
        </div>

        <div style={{ position: "sticky", top: 16 }}>
          <div className="panel">
            <h2>Save</h2>
            {errors.length > 0 && <div className="notice bad"><ul style={{ margin: 0, paddingLeft: 16 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {msg && <div className="notice ok">{msg}</div>}
            <div className="row">
              <button type="button" className="btn primary" disabled={pending} onClick={save}>{pending ? "Saving…" : id ? "Save changes" : "Create version"}</button>
              <button type="button" className="btn" onClick={() => { if (confirm("Replace all formulas with the original Google Sheet logic?")) setRows(defaults); }}>Reset to sheet defaults</button>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>Formulas run top to bottom; a formula can use inputs and anything above it. To add a new earning, add it under Earnings and include its name in <span className="mono">gross</span>.</p>
          </div>
          <div className="panel">
            <h2>Test with</h2>
            <select value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
              {samples.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (past)"}</option>)}
            </select>
            <div className="fields" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
              {(Object.keys(m) as (keyof typeof m)[]).map((k) => (
                <div key={k}><label htmlFor={`t-${k}`}>{k.replace(/_/g, " ")}</label>
                  <input id={`t-${k}`} type="number" value={m[k]} onChange={(e) => setM({ ...m, [k]: Number(e.target.value) || 0 })} /></div>
              ))}
            </div>
            {sample && (
              <table style={{ marginTop: 10 }}><tbody>
                {[["Gross", "gross"], ["Deductions", "total_deductions"], ["In hand", "net_pay"], ["CTC", "ctc"]].map(([l, k]) => (
                  <tr key={k}><td>{l}</td><td className="num"><b>{fmt(preview[k]?.v as number)}</b></td></tr>
                ))}
              </tbody></table>
            )}
          </div>
          <div className="panel">
            <h2>Inputs you can use</h2>
            {["Salary structure", "Month", "Employee"].map((g) => (
              <div key={g} style={{ marginBottom: 8 }}>
                <div className="small muted">{g}</div>
                <div className="chips">
                  {INPUT_VARIABLES.filter((v) => v.group === g).map((v) => <span key={v.key} className="chip" title={v.label}>{v.key}</span>)}
                </div>
              </div>
            ))}
            {extraNames.length > 0 && <div className="small muted">Custom structure fields: <span className="mono">{extraNames.join(", ")}</span></div>}
            <h3 style={{ marginTop: 12 }}>Functions</h3>
            <table><tbody>{FUNCTION_HELP.map(([f, d]) => <tr key={f}><td className="mono small">{f}</td><td className="small muted" style={{ whiteSpace: "normal" }}>{d}</td></tr>)}</tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}
