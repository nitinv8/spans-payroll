import Link from "next/link";
import { pageDb, fmtDate } from "@/lib/data";
import { inr, monthLabel } from "@/lib/payroll";

export default async function Dashboard() {
  const { sb } = await pageDb();
  const [{ data: emps }, { data: runs }] = await Promise.all([
    sb.from("employees").select("id, status, location, name, date_of_joining, date_of_leaving"),
    sb.from("payroll_runs").select("id, month, status, payment_date").order("month", { ascending: false }).limit(12),
  ]);
  const active = (emps || []).filter((e) => e.status === "Active");
  const latest = runs?.[0];
  let totals = { net: 0, gross: 0, ctc: 0, n: 0 };
  if (latest) {
    const { data: lines } = await sb.from("payroll_lines").select("net_pay, gross, ctc").eq("run_id", latest.id);
    for (const l of lines || []) { totals.net += Number(l.net_pay) || 0; totals.gross += Number(l.gross) || 0; totals.ctc += Number(l.ctc) || 0; totals.n++; }
  }
  const byLoc: Record<string, number> = {};
  for (const e of active) byLoc[e.location || "—"] = (byLoc[e.location || "—"] || 0) + 1;
  const { data: noStruct } = await sb.from("employees").select("id, name, salary_structures(id)").eq("status", "Active");
  const missing = (noStruct || []).filter((e: { salary_structures: unknown[] }) => !e.salary_structures?.length);

  return (
    <>
      <div className="pagehead">
        <div><h1>Dashboard</h1><div className="muted">Payroll and employees at a glance</div></div>
        <Link className="btn primary" href="/payroll">Run payroll</Link>
      </div>
      {missing.length > 0 && (
        <div className="notice warn">
          Active employees without a salary structure:{" "}
          {missing.map((e: { id: string; name: string }, i: number) => (
            <span key={e.id}>{i ? ", " : ""}<Link href={`/employees/${e.id}?tab=salary`}>{e.name}</Link></span>
          ))}
        </div>
      )}
      <div className="stats">
        <div className="stat"><b>{active.length}</b><span>Active employees</span></div>
        <div className="stat"><b>{(emps || []).filter((e) => e.status === "Inactive").length}</b><span>Past employees</span></div>
        {(emps || []).some((e) => e.status === "Draft") && (
          <div className="stat"><b>{(emps || []).filter((e) => e.status === "Draft").length}</b><span>Draft (not on payroll)</span></div>
        )}
        {latest && <>
          <div className="stat"><b>₹{inr(totals.net)}</b><span>In-hand · {monthLabel(latest.month)}</span></div>
          <div className="stat"><b>₹{inr(totals.ctc)}</b><span>Cost to company · {monthLabel(latest.month)}</span></div>
        </>}
      </div>
      <div className="grid2">
        <div className="panel">
          <h2>Recent payroll months</h2>
          {!runs?.length ? <p className="muted">No payroll yet.</p> : (
            <table><tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/payroll/${r.id}`}>{monthLabel(r.month)}</Link></td>
                  <td><span className={`badge ${r.status === "finalized" ? "ok" : "warn"}`}>{r.status}</span></td>
                  <td className="muted">{r.payment_date ? `Paid ${fmtDate(r.payment_date)}` : ""}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
        <div className="panel">
          <h2>Active headcount by location</h2>
          <table><tbody>
            {Object.entries(byLoc).sort().map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </>
  );
}
