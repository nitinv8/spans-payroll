import Link from "next/link";
import { notFound } from "next/navigation";
import { pageDb, fmtDate } from "@/lib/data";
import { monthLabel } from "@/lib/payroll";
import { suggestDays } from "@/lib/attendance";
import { applyAttendanceDays } from "@/app/actions";
import ConfirmButton from "@/components/Confirm";

export default async function FillFromAttendance({ params }: { params: { id: string } }) {
  const { sb } = await pageDb();
  const { data: run } = await sb.from("payroll_runs").select("id, month, status").eq("id", params.id).single();
  if (!run) notFound();
  const ym = run.month.slice(0, 7);
  const [{ data: lines }, { data: rows }] = await Promise.all([
    sb.from("payroll_lines").select("id, print_code, employee_id, snapshot, working_days, paid_offs, leaves, lop_days").eq("run_id", run.id),
    sb.from("attendance").select("employee_id, day, in_at, in_on_site, hr_status").gte("day", `${ym}-01`).lte("day", `${ym}-31`),
  ]);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const list = (lines || []).sort((a, b) => Number(a.print_code?.slice(1)) - Number(b.print_code?.slice(1))).map((l) => {
    const mine = (rows || []).filter((r) => r.employee_id === l.employee_id && String(r.day).startsWith(ym));
    const s = suggestDays(l.snapshot, run.month, mine, today);
    const same = s.working_days === Number(l.working_days) && s.paid_offs === Number(l.paid_offs) && s.leaves === Number(l.leaves) && s.lop_days === Number(l.lop_days);
    return { l, s, has: mine.length > 0, same };
  });
  const locked = run.status === "finalized";
  const D = ({ w, o, l, lop }: { w: number; o: number; l: number; lop: number }) => <span className="mono">{w} / {o} / {l} / {lop}</span>;

  return (
    <>
      <div className="pagehead">
        <div><h1>Fill days from attendance · {monthLabel(run.month)}</h1>
          <div className="muted">Suggested days from check-ins and HR marks. Tick who to update; amounts and remarks you entered are kept.</div></div>
        <Link className="btn" href={`/payroll/${run.id}`}>Back to the month</Link>
      </div>
      {locked && <div className="notice warn">This month is finalized. Reopen it to change days.</div>}
      {list.some((x) => x.s.future_days > 0) && <div className="notice warn">The month isn&apos;t over: days after {fmtDate(today)} are counted as normal (worked, Sundays off).</div>}
      <form action={applyAttendanceDays} className="panel">
        <input type="hidden" name="run_id" value={run.id} />
        <p className="small muted" style={{ marginTop: 0 }}>Days shown as worked / offs / paid leave / LOP. A day with no check-in and no HR mark counts as LOP (Sundays as off). Mark missed days on the Attendance page first.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th></th><th>#</th><th>Employee</th><th>Now</th><th>From attendance</th><th className="num">Check-ins</th><th className="num">Away</th><th>Note</th></tr></thead>
            <tbody>
              {list.map(({ l, s, has, same }) => (
                <tr key={l.id}>
                  <td><input type="checkbox" name="line_id" value={l.id} defaultChecked={has && !same} disabled={locked || same} aria-label={`Update ${l.snapshot.name}`} /></td>
                  <td>{l.print_code}</td><td>{l.snapshot.name}</td>
                  <td><D w={Number(l.working_days)} o={Number(l.paid_offs)} l={Number(l.leaves)} lop={Number(l.lop_days)} /></td>
                  <td>{same ? <span className="muted">same</span> : <b><D w={s.working_days} o={s.paid_offs} l={s.leaves} lop={s.lop_days} /></b>}</td>
                  <td className="num">{s.present}</td><td className="num">{s.away || ""}</td>
                  <td className="small muted">{!has ? "No attendance recorded (not ticked)" : s.first_day && s.first_day > `${ym}-03` ? `First check-in ${fmtDate(s.first_day)}; earlier days count as LOP` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!locked && <div style={{ marginTop: 12 }}><ConfirmButton className="btn primary" message="Update the ticked employees' days and recalculate their pay?">Update ticked employees</ConfirmButton></div>}
      </form>
    </>
  );
}
