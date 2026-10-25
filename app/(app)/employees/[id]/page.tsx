import Link from "next/link";
import { notFound } from "next/navigation";
import EmployeeForm from "@/components/EmployeeForm";
import ConfirmButton from "@/components/Confirm";
import SendSlip from "@/components/SendSlip";
import { pageDb, fmtDate } from "@/lib/data";
import { inr, monthLabel } from "@/lib/payroll";
import { saveStructure, deleteStructure, deleteEmployee } from "@/app/actions";

const COMPONENTS = [
  ["basic", "Basic"], ["hra", "HRA"], ["medical", "Medical"], ["conveyance", "Conveyance"], ["mobile", "Mobile"],
  ["site_allowance", "Site allowance"], ["supervisor_allowance", "Supervisory allowance"], ["overtime", "Fixed overtime / leave salary"],
] as const;
const FLAGS = [
  ["esi_applicable", "ESI"], ["pf_applicable", "PF"], ["lwf_applicable", "LWF"], ["bonus_applicable", "Annual bonus"],
  ["gratuity_applicable", "Gratuity"], ["pt_applicable", "Professional tax"],
] as const;

export default async function EmployeePage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; from?: string } }) {
  const { sb } = await pageDb();
  const { data: e } = await sb.from("employees").select("*").eq("id", params.id).single();
  if (!e) notFound();
  const tab = searchParams.tab || "details";
  const { data: structs } = await sb.from("salary_structures").select("*").eq("employee_id", e.id).order("effective_from", { ascending: false });
  const { data: all } = await sb.from("employees").select("location");
  const locations = Array.from(new Set((all || []).map((x) => x.location).filter(Boolean))) as string[];
  const { data: lines } = tab === "payslips"
    ? await sb.from("payroll_lines").select("id, run_id, gross, net_pay, ctc, incentive, manual_adjustment, working_days, paid_offs, leaves, lop_days, payroll_runs(month, status)").eq("employee_id", e.id)
    : { data: null };
  const sortedLines = (lines || []).sort((a: any, b: any) => (a.payroll_runs.month < b.payroll_runs.month ? 1 : -1));
  const { count: paidMonths } = await sb.from("payroll_lines").select("id", { count: "exact", head: true }).eq("employee_id", e.id);
  const latest = structs?.[0];
  const base = searchParams.from ? structs?.find((s) => s.id === searchParams.from) : latest;
  const gross = (s: any) => COMPONENTS.reduce((a, [k]) => a + Number(s[k] || 0), 0);
  const nextMonth = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1); return d.toISOString().slice(0, 10); })();

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{e.name}</h1>
          <div className="muted">{e.emp_code} · {e.designation} · {e.location} · <span className={`badge ${e.status === "Active" ? "ok" : ""}`}>{e.status === "Active" ? "Active" : "Past employee"}</span></div>
        </div>
        <Link className="btn" href="/employees">All employees</Link>
      </div>
      {e.notes && <div className="notice warn">{e.notes}</div>}
      <div className="tabs">
        <Link href={`?tab=details`} className={tab === "details" ? "active" : ""}>Details</Link>
        <Link href={`?tab=salary`} className={tab === "salary" ? "active" : ""}>Salary history ({structs?.length || 0})</Link>
        <Link href={`?tab=payslips`} className={tab === "payslips" ? "active" : ""}>Payslips</Link>
      </div>

      {tab === "details" && (
        <>
          <EmployeeForm e={e} locations={locations} />
          <div className="panel" style={{ marginTop: 24 }}>
            <h2>Remove employee</h2>
            {paidMonths ? (
              <p className="muted" style={{ margin: 0 }}>
                {e.name} is on {paidMonths} payroll month{paidMonths > 1 ? "s" : ""}, so the record is kept for history.
                To remove them from future payrolls, set <b>Employment status</b> to Inactive and fill in the <b>Last date of employment</b>.
              </p>
            ) : (
              <form action={deleteEmployee} className="row">
                <input type="hidden" name="id" value={e.id} />
                <span className="muted">Never paid through payroll, so this record can be deleted along with its salary structures, OT entries and bonus entries.</span>
                <ConfirmButton className="btn danger" message={`Permanently delete ${e.name}? This can't be undone.`}>Delete employee</ConfirmButton>
              </form>
            )}
          </div>
        </>
      )}

      {tab === "salary" && (
        <>
          <div className="panel">
            <h2>Salary revisions</h2>
            <p className="muted small" style={{ marginTop: -4 }}>Each payroll month uses the latest revision whose “effective from” is on or before that month’s end. Past months keep the figures they were run with.</p>
            {!structs?.length ? <p>No salary structure yet — add one below.</p> : (
              <div className="tablewrap">
                <table>
                  <thead><tr>
                    <th>Effective from</th>{COMPONENTS.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Gross</th>
                    <th>Applicable</th><th>Custom</th><th>Remarks</th><th></th>
                  </tr></thead>
                  <tbody>
                    {structs.map((s, i) => (
                      <tr key={s.id}>
                        <td>{fmtDate(s.effective_from)} {i === 0 && <span className="badge ok">current</span>}</td>
                        {COMPONENTS.map(([k]) => <td key={k} className="num">{inr(s[k])}</td>)}
                        <td className="num"><b>{inr(gross(s))}</b></td>
                        <td className="small">{FLAGS.filter(([k]) => s[k]).map(([, l]) => l).join(", ") || "–"}</td>
                        <td className="mono small">{Object.entries(s.extras || {}).map(([k, v]) => `${k}=${v}`).join(", ")}</td>
                        <td className="small">{s.remarks}</td>
                        <td className="row">
                          <Link className="btn sm" href={`?tab=salary&from=${s.id}#revise`}>Copy</Link>
                          <form action={deleteStructure}>
                            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="employee_id" value={e.id} />
                            <ConfirmButton className="btn sm danger" message="Delete this salary revision? Finalized months are not affected.">Delete</ConfirmButton>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <form action={saveStructure} className="panel" id="revise">
            <h2>{structs?.length ? "Add a revision" : "Add salary structure"}</h2>
            <p className="muted small" style={{ marginTop: -4 }}>
              Pre-filled from {base ? `the ${fmtDate(base.effective_from)} revision` : "blank"}. Saving with an existing date overwrites that revision.
            </p>
            <input type="hidden" name="employee_id" value={e.id} />
            <div className="fields">
              <div><label htmlFor="effective_from">Effective from *</label>
                <input id="effective_from" name="effective_from" type="date" required defaultValue={structs?.length ? nextMonth : (e.date_of_joining || nextMonth)} /></div>
              {COMPONENTS.map(([k, l]) => (
                <div key={k}><label htmlFor={k}>{l}</label><input id={k} name={k} type="number" step="0.01" defaultValue={base ? Number(base[k]) : 0} /></div>
              ))}
            </div>
            <div className="row" style={{ margin: "14px 0", gap: 18 }}>
              {FLAGS.map(([k, l]) => (
                <label key={k} className="check"><input type="checkbox" name={k} defaultChecked={base ? !!base[k] : false} /> {l}</label>
              ))}
            </div>
            <div className="grid2">
              <div>
                <label htmlFor="extras">Custom fields for formulas (optional, one per line: <span className="mono">name = amount</span>)</label>
                <textarea id="extras" name="extras" rows={2} placeholder="food_allowance = 1000"
                  defaultValue={base ? Object.entries(base.extras || {}).map(([k, v]) => `${k} = ${v}`).join("\n") : ""} />
              </div>
              <div><label htmlFor="remarks">Remarks (e.g. “Increment Oct 2026”, “Min wage revision”)</label>
                <input id="remarks" name="remarks" defaultValue="" /></div>
            </div>
            <div style={{ marginTop: 14 }}><button className="btn primary">Save revision</button></div>
          </form>
        </>
      )}

      {tab === "payslips" && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Month</th><th>Status</th><th className="num">Days (W/O/L/LOP)</th><th className="num">Gross</th><th className="num">Incentive</th>
              <th className="num">Adjustment</th><th className="num">In hand</th><th className="num">CTC</th><th></th></tr></thead>
            <tbody>
              {sortedLines.map((l: any) => (
                <tr key={l.id}>
                  <td><Link href={`/payroll/${l.run_id}`}>{monthLabel(l.payroll_runs.month)}</Link></td>
                  <td><span className={`badge ${l.payroll_runs.status === "finalized" ? "ok" : "warn"}`}>{l.payroll_runs.status}</span></td>
                  <td className="num">{l.working_days}/{l.paid_offs}/{l.leaves}/{l.lop_days}</td>
                  <td className="num">{inr(l.gross)}</td><td className="num">{inr(l.incentive)}</td><td className="num">{inr(l.manual_adjustment)}</td>
                  <td className="num"><b>{inr(l.net_pay)}</b></td><td className="num">{inr(l.ctc)}</td>
                  <td><div className="row" style={{ flexWrap: "nowrap" }}><a className="btn sm" href={`/api/lines/${l.id}/slip`}>Slip PDF</a>
                    <SendSlip compact lineId={l.id} name={e.name} month={l.payroll_runs.month} netPay={l.net_pay} contact={{ email: e.email, mobile: e.mobile }} /></div></td>
                </tr>
              ))}
              {!sortedLines.length && <tr><td colSpan={9} className="muted">No payslips yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
