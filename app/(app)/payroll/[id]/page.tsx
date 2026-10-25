import Link from "next/link";
import { notFound } from "next/navigation";
import { pageDb, fmtDate } from "@/lib/data";
import { inr, monthLabel, financialYear, type FormulaRow } from "@/lib/payroll";
import { complianceSummary, type LineRow } from "@/lib/exports";
import { eligibleForMonth, sortEmployees, type Employee } from "@/lib/run-logic";
import ConfirmButton from "@/components/Confirm";
import LinesEditor from "./LinesEditor";
import {
  finalizeRun, reopenRun, deleteRun, refreshRun, pullOtIncentives, updateRunMeta, addEmployeeToRun, removeLine,
} from "@/app/actions";

export default async function RunPage({ params }: { params: { id: string } }) {
  const { sb } = await pageDb();
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", params.id).single();
  if (!run) notFound();
  const { data: rawLines } = await sb.from("payroll_lines").select("*").eq("run_id", run.id);
  const lines = ((rawLines || []) as (LineRow & { employee_id: string })[]).sort(
    (a, b) => Number(a.print_code?.slice(1)) - Number(b.print_code?.slice(1)));
  const { data: emps } = await sb.from("employees").select("*");
  const { data: settings } = await sb.from("company_settings").select("orgzit").eq("id", 1).single();
  const formulas = run.formulas as FormulaRow[];
  // Current contact details (personal email/mobile), used by the send-payslip buttons
  const contacts = Object.fromEntries((emps || []).map((e) => [e.id, { email: e.email as string | null, mobile: e.mobile as string | null }]));
  const locked = run.status === "finalized";

  const present = new Set(lines.map((l) => l.employee_id));
  const addable = sortEmployees((emps || []) as Employee[]).filter((e) => !present.has(e.id));
  const missingEligible = addable.filter((e) => eligibleForMonth(e, run.month));
  const errors = lines.filter((l) => l.error);
  const noOrgzit = lines.filter((l) => !l.snapshot.orgzit_id);
  const noBank = lines.filter((l) => l.snapshot.include_in_bank_file && (!l.snapshot.bank_account || !l.snapshot.ifsc));
  const dupOrgzit = Object.entries(lines.reduce<Record<string, string[]>>((m, l) => {
    if (l.snapshot.orgzit_id) (m[l.snapshot.orgzit_id] ||= []).push(l.snapshot.name); return m;
  }, {})).filter(([, names]) => names.length > 1);
  const fy = financialYear(run.month);
  const fyMissing = !(settings?.orgzit as { fy_ids?: Record<string, string> })?.fy_ids?.[fy];
  const comp = complianceSummary(lines);
  const tot = lines.reduce((a, l) => ({ gross: a.gross + (Number(l.gross) || 0), net: a.net + (Number(l.net_pay) || 0), ctc: a.ctc + (Number(l.ctc) || 0) }), { gross: 0, net: 0, ctc: 0 });

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{monthLabel(run.month)} payroll</h1>
          <div className="muted">
            <span className={`badge ${locked ? "ok" : "warn"}`}>{run.status}</span>{" "}
            {locked && run.finalized_at && <>by {run.finalized_by} on {fmtDate(run.finalized_at.slice(0, 10))} · </>}
            {lines.length} employees · In hand ₹{inr(tot.net)} · CTC ₹{inr(tot.ctc)}
          </div>
        </div>
        <div className="row">
          {!locked && (
            <form action={finalizeRun}><input type="hidden" name="run_id" value={run.id} />
              <ConfirmButton className="btn primary" message="Finalize and lock this month? Figures will be frozen; you can reopen later if needed.">Finalize &amp; lock</ConfirmButton>
            </form>
          )}
          {locked && (
            <form action={reopenRun}><input type="hidden" name="run_id" value={run.id} />
              <ConfirmButton message="Reopen this month for editing? Any re-calculation will use the formulas stored with this month.">Reopen</ConfirmButton>
            </form>
          )}
          <Link className="btn" href="/payroll">All months</Link>
        </div>
      </div>

      <div className="panel">
        <h2>Outputs</h2>
        <div className="row">
          <a className="btn primary" href={`/api/runs/${run.id}/slips`}>Salary slips: one PDF</a>
          <a className="btn" href={`/api/runs/${run.id}/slips-zip`}>Salary slips: ZIP of individual PDFs</a>
          <a className="btn primary" href={`/api/runs/${run.id}/hdfc`}>HDFC bank CSV</a>
          <a className="btn primary" href={`/api/runs/${run.id}/orgzit`}>Orgzit upload CSV</a>
          <a className="btn" href={`/api/runs/${run.id}/register`}>Salary register CSV</a>
        </div>
        {!locked && <p className="muted small" style={{ marginBottom: 0 }}>Tip: finalize before sending the bank file so the figures can&apos;t change afterwards.</p>}
      </div>

      {(errors.length > 0 || missingEligible.length > 0 || noOrgzit.length > 0 || noBank.length > 0 || dupOrgzit.length > 0 || fyMissing) && (
        <div className="notice warn">
          <b>Check before exporting</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {errors.map((l) => <li key={l.id}>{l.snapshot.name}: {l.error}</li>)}
            {missingEligible.length > 0 && <li>Employed this month but not on this payroll: {missingEligible.map((e) => e.name).join(", ")}</li>}
            {noBank.length > 0 && <li>Missing bank details (will be skipped in HDFC file): {noBank.map((l) => l.snapshot.name).join(", ")}</li>}
            {noOrgzit.length > 0 && <li>No Orgzit ID: {noOrgzit.map((l) => l.snapshot.name).join(", ")}</li>}
            {dupOrgzit.map(([id, names]) => <li key={id}>Same Orgzit ID <span className="mono">{id}</span> used for {names.join(" and ")}</li>)}
            {fyMissing && <li>No Orgzit “Financial Year” ID for {fy}: add it in <Link href="/settings">Settings</Link>.</li>}
          </ul>
        </div>
      )}

      {!locked && (
        <div className="panel row" style={{ alignItems: "end", gap: 14 }}>
          <form action={updateRunMeta} className="row" style={{ alignItems: "end" }}>
            <input type="hidden" name="run_id" value={run.id} />
            <div><label htmlFor="payment_date">Bank transfer date</label><input id="payment_date" name="payment_date" type="date" defaultValue={run.payment_date || ""} /></div>
            <div style={{ minWidth: 240 }}><label htmlFor="notes">Notes</label><input id="notes" name="notes" defaultValue={run.notes || ""} /></div>
            <button className="btn">Save</button>
          </form>
          <form action={pullOtIncentives}><input type="hidden" name="run_id" value={run.id} />
            <ConfirmButton message="Replace each employee's Incentive with the total from OT incentives for this month?">Pull OT incentives</ConfirmButton>
          </form>
          <form action={refreshRun}><input type="hidden" name="run_id" value={run.id} />
            <ConfirmButton message="Re-calculate everyone with the current formulas, employee details and salary structures? Days and amounts you entered are kept.">Re-calculate with latest data</ConfirmButton>
          </form>
          {addable.length > 0 && (
            <form action={addEmployeeToRun} className="row" style={{ alignItems: "end" }}>
              <input type="hidden" name="run_id" value={run.id} />
              <div><label htmlFor="employee_id">Add employee</label>
                <select id="employee_id" name="employee_id">{addable.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status === "Active" ? "active" : "past"})</option>)}</select></div>
              <button className="btn">Add</button>
            </form>
          )}
          <form action={deleteRun} style={{ marginLeft: "auto" }}><input type="hidden" name="run_id" value={run.id} />
            <ConfirmButton className="btn danger" message="Delete this whole payroll month?">Delete month</ConfirmButton>
          </form>
        </div>
      )}

      <LinesEditor key={lines.map((l) => `${l.id}:${(l as { updated_at?: string }).updated_at}:${l.net_pay}`).join("|") + run.status} lines={lines} formulas={formulas} locked={locked} month={run.month} runId={run.id} removeAction={removeLine} contacts={contacts} />

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>PF / ESI / LWF summary</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>State</th><th className="num">ESI members</th><th className="num">ESI wages</th><th className="num">ESI employee</th><th className="num">ESI employer</th><th className="num">ESI total</th>
              <th className="num">PF members</th><th className="num">EPF wages</th><th className="num">PF employee</th><th className="num">PF employer</th><th className="num">LWF emp + er</th></tr></thead>
            <tbody>
              {comp.map((c) => (
                <tr key={c.state}><td>{c.state}</td><td className="num">{c.heads}</td><td className="num">{inr(c.esi_wage)}</td><td className="num">{inr(c.esi_emp)}</td>
                  <td className="num">{inr(c.esi_er)}</td><td className="num"><b>{inr(c.esi_emp + c.esi_er)}</b></td><td className="num">{c.pf_heads}</td>
                  <td className="num">{inr(c.pf_wage)}</td><td className="num">{inr(c.pf_emp)}</td><td className="num">{inr(c.pf_er)}</td><td className="num">{inr(c.lwf_emp + c.lwf_er)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
