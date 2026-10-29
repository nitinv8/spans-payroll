import Link from "next/link";
import Punch from "./Punch";
import { myDb, rupees, timeIST, todayIST, type MyDay, type MySlip } from "@/lib/my";
import { monthLabel } from "@/lib/payroll";

export default async function Today() {
  const { sb, me } = await myDb();
  if (!me) return null;
  const today = todayIST();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [{ data: days }, { data: slips }] = await Promise.all([
    sb.rpc("my_attendance", { p_from: monthStart, p_to: today }), sb.rpc("my_payslips"),
  ]);
  const list = (days || []) as MyDay[];
  const t = list.find((d) => d.day === today);
  const present = list.filter((d) => d.in_at || d.hr_status === "present" || d.hr_status === "half_day").length;
  const away = list.filter((d) => d.in_at && d.in_on_site === false).length;
  const last = ((slips || []) as MySlip[])[0];
  const active = me.status === "Active";
  const dateLabel = new Date(today + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <>
      {active && (
        <div className="staff-card">
          <div className="muted small">{dateLabel}</div>
          <h2 style={{ marginTop: 2 }}>Today&apos;s attendance</h2>
          {t?.in_at && (
            <div style={{ marginBottom: 12 }}>
              <div className="staff-row"><span className="k">Checked in</span>
                <span className="v">{timeIST(t.in_at)} {t.in_on_site === false ? <span className="pill warn">away from site</span> : t.in_site ? <span className="pill ok">{t.in_site}</span> : null}</span></div>
              {t.out_at && <div className="staff-row"><span className="k">Checked out</span>
                <span className="v">{timeIST(t.out_at)} {t.out_on_site === false ? <span className="pill warn">away from site</span> : t.out_site ? <span className="pill ok">{t.out_site}</span> : null}</span></div>}
            </div>
          )}
          {!t?.in_at ? <Punch employeeId={me.id} kind="in" today={today} />
            : !t.out_at ? <Punch employeeId={me.id} kind="out" today={today} />
            : <div className="notice ok" style={{ margin: 0 }}>Done for today. See you tomorrow!</div>}
          {t?.hr_status && <p className="muted small" style={{ marginBottom: 0 }}>Marked by HR: {t.hr_status.replace("_", " ")}{t.hr_note ? ` (${t.hr_note})` : ""}</p>}
        </div>
      )}

      {active && (
        <Link href="/my/attendance" className="staff-card" style={{ display: "block", color: "inherit" }}>
          <h2>{monthLabel(monthStart)}</h2>
          <div className="big">{present} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>days present so far</span></div>
          {away > 0 && <div className="muted small">{away} day{away > 1 ? "s" : ""} checked in away from a site</div>}
        </Link>
      )}

      {last ? (
        <Link href="/my/payslips" className="staff-card" style={{ display: "block", color: "inherit" }}>
          <h2>Latest payslip · {monthLabel(last.month)}</h2>
          <div className="big">{rupees(last.net_pay)}</div>
          <div className="muted small">In-hand salary{last.payment_date ? ` · paid ${new Date(last.payment_date + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""} · Tap to download</div>
        </Link>
      ) : (
        <div className="staff-card"><h2>Payslips</h2><p className="muted" style={{ margin: 0 }}>Your payslips will appear here after each month is finalized.</p></div>
      )}
    </>
  );
}
