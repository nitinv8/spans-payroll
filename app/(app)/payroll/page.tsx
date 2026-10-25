import Link from "next/link";
import { pageDb, fmtDate } from "@/lib/data";
import { inr, monthLabel, thisMonthIST } from "@/lib/payroll";
import { createRun } from "@/app/actions";

export default async function Payroll() {
  const { sb } = await pageDb();
  const [{ data: runs }, { data: lines }] = await Promise.all([
    sb.from("payroll_runs").select("id, month, status, payment_date, finalized_by").order("month", { ascending: false }),
    sb.from("payroll_lines").select("run_id, net_pay, gross, ctc"),
  ]);
  const t: Record<string, { n: number; net: number; gross: number; ctc: number }> = {};
  for (const l of lines || []) {
    const x = (t[l.run_id] ||= { n: 0, net: 0, gross: 0, ctc: 0 });
    x.n++; x.net += Number(l.net_pay) || 0; x.gross += Number(l.gross) || 0; x.ctc += Number(l.ctc) || 0;
  }
  const latest = runs?.[0]?.month;
  const next = latest ? new Date(Date.UTC(+latest.slice(0, 4), +latest.slice(5, 7), 1)).toISOString().slice(0, 7) : thisMonthIST().slice(0, 7);
  return (
    <>
      <div className="pagehead"><div><h1>Monthly payroll</h1><div className="muted">One payroll per month. Finalize to lock it.</div></div></div>
      <form action={createRun} className="panel row" style={{ alignItems: "end", gap: 14 }}>
        <div><label htmlFor="month">Month</label><input id="month" name="month" type="month" defaultValue={next} required /></div>
        <div><label htmlFor="payment_date">Bank transfer date</label><input id="payment_date" name="payment_date" type="date" /></div>
        <button className="btn primary">Start payroll</button>
        <span className="muted small" style={{ flexBasis: "100%" }}>
          Adds everyone employed that month with their applicable salary structure (draft employees are never included). Sundays are pre-filled as paid offs, and that month&apos;s OT incentives go into Incentive.
        </span>
      </form>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Month</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">In hand</th><th className="num">Cost to company</th><th>Paid on</th></tr></thead>
          <tbody>
            {(runs || []).map((r) => (
              <tr key={r.id}>
                <td><Link href={`/payroll/${r.id}`}><b>{monthLabel(r.month)}</b></Link></td>
                <td><span className={`badge ${r.status === "finalized" ? "ok" : "warn"}`}>{r.status}</span></td>
                <td className="num">{t[r.id]?.n || 0}</td><td className="num">{inr(t[r.id]?.gross)}</td>
                <td className="num"><b>{inr(t[r.id]?.net)}</b></td><td className="num">{inr(t[r.id]?.ctc)}</td>
                <td>{fmtDate(r.payment_date)}</td>
              </tr>
            ))}
            {!runs?.length && <tr><td colSpan={7} className="muted">No payroll months yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
