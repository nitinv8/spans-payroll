import { pageDb, fmtDate } from "@/lib/data";
import { DEFAULT_FORMULAS, type FormulaRow } from "@/lib/payroll";
import { structureValues, type Structure } from "@/lib/run-logic";
import FormulaEditor from "./FormulaEditor";

export default async function Formulas({ searchParams }: { searchParams: { set?: string; new?: string } }) {
  const { sb } = await pageDb();
  const [{ data: sets }, { data: emps }, { data: structs }, { data: used }] = await Promise.all([
    sb.from("formula_sets").select("*").order("effective_from", { ascending: false }),
    sb.from("employees").select("id, name, location, designation, date_of_joining, status").order("name"),
    sb.from("salary_structures").select("*").order("effective_from", { ascending: false }),
    sb.from("payroll_runs").select("formula_set_id, month, status"),
  ]);
  const current = searchParams.new ? null : (sets || []).find((s) => s.id === searchParams.set) || sets?.[0] || null;
  const base = searchParams.new ? (sets || []).find((s) => s.id === searchParams.new) : null;
  const samples = (emps || []).map((e) => {
    const s = (structs || []).find((x: Structure) => x.employee_id === e.id);
    return s ? { id: e.id, name: e.name, location: e.location || "", designation: e.designation || "", date_of_joining: e.date_of_joining, active: e.status === "Active", structure: structureValues(s) } : null;
  }).filter(Boolean) as any[];
  const nextMonth = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); return d.toISOString().slice(0, 10); })();

  return (
    <>
      <div className="pagehead">
        <div><h1>Formulas</h1><div className="muted">Every rate and calculation used in payroll. Edit them here; no code changes needed.</div></div>
        <div className="row">
          {(sets || []).map((s) => (
            <a key={s.id} className={`btn sm ${current?.id === s.id ? "primary" : ""}`} href={`?set=${s.id}`}>From {fmtDate(s.effective_from)}</a>
          ))}
          {current && <a className="btn sm" href={`?new=${current.id}`}>+ New version</a>}
        </div>
      </div>
      <FormulaEditor
        key={current?.id || `new-${base?.id || ""}`}
        id={current?.id || null}
        effectiveFrom={current?.effective_from || (base ? nextMonth : "2026-04-01")}
        name={current?.name || (base ? `${base.name} (revised)` : "Formula set")}
        notes={current?.notes || ""}
        initial={(current?.formulas || base?.formulas || DEFAULT_FORMULAS) as FormulaRow[]}
        defaults={DEFAULT_FORMULAS}
        samples={samples}
        usedBy={(used || []).filter((r) => r.formula_set_id === current?.id).map((r) => `${r.month.slice(0, 7)} (${r.status})`)}
      />
    </>
  );
}
