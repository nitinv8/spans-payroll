import Link from "next/link";
import { notFound } from "next/navigation";
import { pageDb, fmtDate } from "@/lib/data";
import { inr, monthLabel, financialYear, type FormulaRow } from "@/lib/payroll";
import { complianceSummary, hdfcCsv, type LineRow, type RunRow } from "@/lib/exports";
import { lineChecks } from "@/lib/checks";
import ConfirmLink from "@/components/ConfirmLink";
import { eligibleForMonth, sortEmployees, type Employee } from "@/lib/run-logic";
import ConfirmButton from "@/components/Confirm";
import LinesEditor from "./LinesEditor";
import {
  finalizeRun, reopenRun, deleteRun, refreshRun, pullOtIncentives, updateRunMeta, addEmployeeToRun, removeLine,
} from "@/app/actions";

export default async function RunPage({ params }: { params: { id: string } }) {
  const { sb } = await pageDb();
  // All four lookups in parallel (one round trip instead of four)
  const [{ data: run }, { data: rawLines }, { data: emps }, { data: settings }] = await Promise.all([
    sb.from("payroll_runs").select("*").eq("id", params.id).single(),
    sb.from("payroll_lines").select("*").eq("run_id", params.id),
    sb.from("employees").select("*"),
    sb.from("company_settings").select("orgzit").eq("id", 1).single(),
  ]);
  if (!run) notFound();
  const lines = ((rawLines || []) as (LineRow & { employee_id: string })[]).sort(
    (a, b) => Number(a.print_code?.slice(1)) - Number(b.print_code?.slice(1)));
  // Export history and last month's bank accounts (for the change alert)
  const [{ data: exportsLog }, { data: prevRuns }] = await Promise.all([
    sb.from("export_log").select("kind, rows, total, actor, at").eq("run_id", run.id).order("at", { ascending: false }),
    sb.from("payroll_runs").select("id").lt("month", run.month).order("month", { ascending: false }).limit(1),
  ]);
  const { data: prevLines } = prevRuns?.[0]
    ? await sb.from("payroll_lines").select("employee_id, snapshot").eq("run_id", prevRuns[0].id)
    : { data: [] as { employee_id: string; snapshot: { bank_account?: string | null } }[] };
  const previousBank = Object.fromEntries((prevLines || []).map((p) => [p.employee_id, (p.snapshot as { bank_account?: string | null })?.bank_account ?? null]));
  const formulas = run.formulas as FormulaRow[];
  // Current contact details (personal email/mobile), used by the send-payslip buttons
  const contacts = Object.fromEntries((emps || []).map((e) => [e.id, { email: e.email as string | null, mobile: e.mobile as string | null }]));
  const locked = run.status === "finalized";

  const present = new Set(lines.map((l) => l.employee_id));
  const addable = sortEmployees((emps || []) as Employee[]).filter((e) => !present.has(e.id) && e.status !== "Draft");
  const missingEligible = addable.filter((e) => eligibleForMonth(e, run.month));
  const noOrgzit = lines.filter((l) => !l.snapshot.orgzit_id);
  const noBank = lines.filter((l) => l.snapshot.include_in_bank_file && (!l.snapshot.bank_account || !l.snapshot.ifsc));
  const dupOrgzit = Object.entries(lines.reduce<Record<string, string[]>>((m, l) => {
    if (l.snapshot.orgzit_id) (m[l.snapshot.orgzit_id] ||= []).push(l.snapshot.name); return m;
  }, {})).filter(([, names]) => names.length > 1);
  const esiCeiling = Number((run.formulas as FormulaRow[]).find((f) => f.key === "esi_wage_ceiling")?.expr) || 21000;
  const checks = lineChecks(run.month, lines, { esiCeiling, previousBank });
  const bankChanged = checks.filter((c) => c.text.startsWith("Bank account changed")).map((c) => c.who);
  const bank = hdfcCsv(run as RunRow, lines.filter((l) => !l.error));
  const lastExport = (kind: string) => (exportsLog || []).find((x) => x.kind === kind);
  const ist = (at: string) => new Date(at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const hdfcNotes = [
    lastExport("hdfc") ? `The HDFC file was already generated on ${ist(lastExport("hdfc")!.at)} (₹${inr(lastExport("hdfc")!.total)}). Make sure it isn't uploaded twice.` : "",
    bankChanged.length ? `Bank account changed since last month for: ${bankChanged.join(", ")}. Confirm these with the employees before paying.` : "",
  ].filter(Boolean);
  const hdfcWarning = hdfcNotes.length ? hdfcNotes.join("\n\n") + "\n\nDownload anyway?" : undefined;
  const fy = financialYear(run.month);
  const fyMissing = !(settings?.orgzit as { fy_ids?: Record<string, string> })?.fy_ids?.[fy];
  const comp = complianceSummary(lines);
  const compTot = comp.reduce((a, c) => ({
    heads: a.heads + c.heads, esi_wage: a.esi_wage + c.esi_wage, esi_emp: a.esi_emp + c.esi_emp, esi_er: a.esi_er + c.esi_er,
    pf_heads: a.pf_heads + c.pf_heads, pf_wage: a.pf_wage + c.pf_wage, pf_emp: a.pf_emp + c.pf_emp, pf_er: a.pf_er + c.pf_er,
    lwf_emp: a.lwf_emp + c.lwf_emp, lwf_er: a.lwf_er + c.lwf_er, pt: a.pt + c.pt, pt_heads: a.pt_heads + c.pt_heads,
  }), { heads: 0, esi_wage: 0, esi_emp: 0, esi_er: 0, pf_heads: 0, pf_wage: 0, pf_emp: 0, pf_er: 0, lwf_emp: 0, lwf_er: 0, pt: 0, pt_heads: 0 });
  const tot = lines.reduce((a, l) => ({ gross: a.gross + (Number(l.gross) || 0), net: a.net + (Number(l.net_pay) || 0), ctc: a.ctc + (Number(l.ctc) || 0) }), { gross: 0, net: 0, ctc: 0 });

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{monthLabel(run.month)} payroll</h1>
          <div className="muted">
            <span className={`badge ${locked ? "ok" : "warn"}`}>{run.status}</span>{" "}
            {locked && run.finalized_at && <>{run.finalized_by === "import" ? "imported from Google Sheet" : `by ${run.finalized_by}`} on {fmtDate(run.finalized_at.slice(0, 10))} · </>}
            {lines.length} {lines.length === 1 ? "employee" : "employees"} · In hand ₹{inr(tot.net)} · CTC ₹{inr(tot.ctc)}
          </div>
        </div>
        <div className="row">
          {!locked && (
            <form action={finalizeRun}><input type="hidden" name="run_id" value={run.id} />
              <ConfirmButton className="btn primary" message="Finalize and lock this month? Figures will be frozen; you can reopen later if needed.">Finalize &amp; lock</ConfirmButton>
            </form>
          )}
          {!locked && (
            <form action={deleteRun}><input type="hidden" name="run_id" value={run.id} />
              <ConfirmButton className="btn danger" message={`Delete the whole ${monthLabel(run.month)} payroll, including all days and amounts entered? This can't be undone.`}>Delete month</ConfirmButton>
            </form>
          )}
          {locked && (
            <form action={reopenRun}><input type="hidden" name="run_id" value={run.id} />
              <ConfirmButton message={"Reopen this month for editing?\n\nThe reopen is recorded in the audit log. Bank and Orgzit files can't be downloaded again until you finalize. If the HDFC file was already uploaded, don't upload a second one."}>Reopen</ConfirmButton>
            </form>
          )}
          <Link className="btn" href="/payroll">All months</Link>
        </div>
      </div>

      <div className="panel">
        <h2>Outputs</h2>
        <div className="row">
          <a className="btn" href={`/api/runs/${run.id}/slips`}>{locked ? "Salary slips: one PDF" : "Provisional slips (PDF)"}</a>
          <a className="btn" href={`/api/runs/${run.id}/slips-zip`}>{locked ? "Slips: ZIP of individual PDFs" : "Provisional slips (ZIP)"}</a>
          {locked ? (
            <>
              <ConfirmLink className="btn primary" href={`/api/runs/${run.id}/hdfc`}
                message={hdfcWarning}>
                HDFC bank CSV
              </ConfirmLink>
              <ConfirmLink className="btn primary" href={`/api/runs/${run.id}/orgzit`}
                message={lastExport("orgzit") ? `The Orgzit file was already generated on ${ist(lastExport("orgzit")!.at)}. Uploading it twice would double-count salary in the books. Download again?` : undefined}>
                Orgzit upload CSV
              </ConfirmLink>
            </>
          ) : (
            <>
              <button className="btn" disabled title="Finalize the month first">HDFC bank CSV</button>
              <button className="btn" disabled title="Finalize the month first">Orgzit upload CSV</button>
            </>
          )}
          <a className="btn" href={`/api/runs/${run.id}/register`}>Salary register CSV</a>
        </div>
        {!locked && <p className="muted small" style={{ marginBottom: 0 }}>The HDFC and Orgzit files unlock after you <b>Finalize &amp; lock</b>, so amounts can&apos;t change after the bank file is made. Slips from an unfinalized month are marked PROVISIONAL.</p>}

        <div className="grid2" style={{ marginTop: 14 }}>
          <div>
            <h3>Bank file preview</h3>
            <table><tbody>
              <tr><td>Payroll in-hand total</td><td className="num">₹{inr(tot.net)}</td></tr>
              <tr><td>In HDFC file ({bank.count} {bank.count === 1 ? "person" : "people"})</td><td className="num"><b>₹{inr(bank.total)}</b></td></tr>
              {bank.skipped.map((x) => (
                <tr key={x.name}><td className="muted">Not in file: {x.name} ({x.reason})</td><td className="num muted">₹{inr(x.amount)}</td></tr>
              ))}
              {Math.round(tot.net - bank.total - bank.skipped.reduce((a, x) => a + x.amount, 0)) !== 0 && (
                <tr><td style={{ color: "var(--bad)" }}>Unreconciled difference (rows with errors)</td>
                  <td className="num" style={{ color: "var(--bad)" }}>₹{inr(tot.net - bank.total - bank.skipped.reduce((a, x) => a + x.amount, 0))}</td></tr>
              )}
            </tbody></table>
          </div>
          <div>
            <h3>Export history</h3>
            {!exportsLog?.length ? <p className="muted small">Nothing exported yet for this month.</p> : (
              <table><tbody>
                {exportsLog.slice(0, 8).map((x, i) => (
                  <tr key={i}><td className="small">{new Date(x.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="small">{{ hdfc: "HDFC file", orgzit: "Orgzit file", register: "Register", slips: "Slips" }[x.kind as string] ?? x.kind}</td>
                    <td className="small num">{x.total ? `₹${inr(x.total)}` : `${x.rows}`}</td><td className="small muted">{x.actor}</td></tr>
                ))}
              </tbody></table>
            )}
          </div>
        </div>
      </div>

      {(checks.length > 0 || missingEligible.length > 0 || noOrgzit.length > 0 || noBank.length > 0 || dupOrgzit.length > 0 || fyMissing) && (
        <div className="notice warn">
          <b>Check before exporting</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {checks.map((c, i) => <li key={i} style={c.level === "error" ? { color: "var(--bad)" } : undefined}><b>{c.who}:</b> {c.text}</li>)}
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
          <form action={refreshRun} className="recalc">
            <input type="hidden" name="run_id" value={run.id} />
            <div className="small muted" style={{ marginBottom: 4 }}>Re-calculate (days and amounts are kept):</div>
            <label className="check small"><input type="checkbox" name="refresh_structures" defaultChecked /> Use current salary structures</label>
            <label className="check small"><input type="checkbox" name="refresh_details" /> Copy current employee details (bank, UAN…)</label>
            <label className="check small"><input type="checkbox" name="use_latest_formulas" /> Switch to latest formula version</label>
            <ConfirmButton className="btn sm" message="Re-calculate this month with the selected options?">Re-calculate</ConfirmButton>
          </form>
          {addable.length > 0 && (
            <form action={addEmployeeToRun} className="row" style={{ alignItems: "end" }}>
              <input type="hidden" name="run_id" value={run.id} />
              <div><label htmlFor="employee_id">Add employee</label>
                <select id="employee_id" name="employee_id">{addable.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status === "Active" ? "active" : "past"})</option>)}</select></div>
              <button className="btn">Add</button>
            </form>
          )}
        </div>
      )}

      <LinesEditor key={run.id + run.status} lines={lines} formulas={formulas} locked={locked} month={run.month} runId={run.id} removeAction={removeLine} contacts={contacts} />

      <div className="panel" style={{ marginTop: 16 }}>
        <h2>PF / ESI / LWF / PT summary</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>State</th><th className="num">ESI members</th><th className="num">ESI wages</th><th className="num">ESI employee</th><th className="num">ESI employer</th><th className="num">ESI total</th>
              <th className="num">PF members</th><th className="num">EPF wages</th><th className="num">PF employee</th><th className="num">PF employer</th><th className="num">PF total</th><th className="num">LWF employee</th><th className="num">LWF employer</th><th className="num">Prof. tax</th></tr></thead>
            <tbody>
              {comp.map((c) => (
                <tr key={c.state}><td>{c.state}</td><td className="num">{c.heads}</td><td className="num">{inr(c.esi_wage)}</td><td className="num">{inr(c.esi_emp)}</td>
                  <td className="num">{inr(c.esi_er)}</td><td className="num"><b>{inr(c.esi_emp + c.esi_er)}</b></td><td className="num">{c.pf_heads}</td>
                  <td className="num">{inr(c.pf_wage)}</td><td className="num">{inr(c.pf_emp)}</td><td className="num">{inr(c.pf_er)}</td><td className="num"><b>{inr(c.pf_emp + c.pf_er)}</b></td><td className="num">{inr(c.lwf_emp)}</td><td className="num">{inr(c.lwf_er)}</td>
                  <td className="num" title={`${c.pt_heads} employee(s)`}>{inr(c.pt)}</td></tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td><td className="num">{compTot.heads}</td><td className="num">{inr(compTot.esi_wage)}</td><td className="num">{inr(compTot.esi_emp)}</td>
                <td className="num">{inr(compTot.esi_er)}</td><td className="num">{inr(compTot.esi_emp + compTot.esi_er)}</td><td className="num">{compTot.pf_heads}</td>
                <td className="num">{inr(compTot.pf_wage)}</td><td className="num">{inr(compTot.pf_emp)}</td><td className="num">{inr(compTot.pf_er)}</td>
                <td className="num">{inr(compTot.pf_emp + compTot.pf_er)}</td><td className="num">{inr(compTot.lwf_emp)}</td><td className="num">{inr(compTot.lwf_er)}</td>
                <td className="num">{inr(compTot.pt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
