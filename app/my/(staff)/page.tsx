import Link from "next/link";
import Punch from "./Punch";
import WeekOff, { type WeekDay } from "./WeekOff";
import Reminders from "./Reminders";
import { myDb, rupees, timeIST, todayIST, type MyDay, type MySlip } from "@/lib/my";
import { monthLabel } from "@/lib/payroll";

export default async function Today() {
  const { sb, me } = await myDb();
  if (!me) return null;
  const today = todayIST();
  const monthStart = `${today.slice(0, 7)}-01`;
  const add = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const monday = add(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7));
  const from = [monthStart, add(today, -1), monday].sort()[0];
  const [{ data: days }, { data: slips }] = await Promise.all([
    sb.rpc("my_attendance", { p_from: from, p_to: add(monday, 13) }), sb.rpc("my_payslips"),
  ]);
  const all = (days || []) as MyDay[];
  const byDay = new Map(all.map((d) => [d.day, d]));
  const list = all.filter((d) => d.day >= monthStart && d.day <= today);
  const t = byDay.get(today);
  // A shift still open from the last 18 hours (e.g. checked in at 10 PM yesterday) is checked out from here
  const open = all.filter((d) => d.in_at && !d.out_at && Date.now() - Date.parse(d.in_at) < 18 * 3600e3)
    .sort((a, b) => Date.parse(b.in_at!) - Date.parse(a.in_at!))[0];
  const openFromYesterday = open && open.day !== today;
  const present = list.filter((d) => d.in_at || d.hr_status === "present" || d.hr_status === "half_day").length;
  const away = list.filter((d) => d.in_at && d.in_on_site === false).length;
  const offs = list.filter((d) => !d.in_at && !d.hr_status && d.self_status === "week_off").length;
  const week = (start: string) => Array.from({ length: 7 }, (_, i) => {
    const day = add(start, i), r = byDay.get(day);
    return { day, off: r?.self_status === "week_off", worked: !!r?.in_at, hr: !!r?.hr_status } as WeekDay;
  });
  const weeks = [{ label: "This week", days: week(monday) }, { label: "Next week", days: week(add(monday, 7)) }];
  const offToday = t?.self_status === "week_off" && !t.in_at && !t.hr_status;
  const last = ((slips || []) as MySlip[])[0];
  const active = me.status === "Active";
  const dateLabel = new Date(today + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <>
      {active && (
        <div className="staff-card">
          <div className="muted small">{dateLabel}</div>
          <h2 style={{ marginTop: 2 }}>Today&apos;s attendance</h2>
          {openFromYesterday && (
            <div style={{ marginBottom: 12 }}>
              <div className="staff-row"><span className="k">Shift started</span>
                <span className="v">{timeIST(open.in_at)} {dayName(open.day, today)} {open.in_site ? <span className="pill ok">{open.in_site}</span> : null}</span></div>
            </div>
          )}
          {t?.in_at && (
            <div style={{ marginBottom: 12 }}>
              <div className="staff-row"><span className="k">Checked in</span>
                <span className="v">{timeIST(t.in_at)} {t.in_on_site === false ? <span className="pill warn">away from site</span> : t.in_site ? <span className="pill ok">{t.in_site}</span> : null}</span></div>
              {t.out_at && <div className="staff-row"><span className="k">Checked out</span>
                <span className="v">{timeIST(t.out_at)} {t.out_on_site === false ? <span className="pill warn">away from site</span> : t.out_site ? <span className="pill ok">{t.out_site}</span> : null}</span></div>}
            </div>
          )}
          {open ? (
            <>
              <Punch employeeId={me.id} kind="out" today={today} label={openFromYesterday ? "Check out (night shift)" : undefined} />
              {openFromYesterday && !t?.in_at && <Punch employeeId={me.id} kind="in" today={today} alt label="Forgot to check out? Check in for today's shift instead" />}
            </>
          ) : t?.in_at ? <div className="notice ok" style={{ margin: 0 }}>Done for today. See you tomorrow!</div>
            : offToday ? <>
                <div className="notice ok" style={{ marginTop: 0 }}>Today is marked as your weekly off. Enjoy your day!</div>
                <Punch employeeId={me.id} kind="in" today={today} alt label="Working today after all? Check in" />
              </>
            : <Punch employeeId={me.id} kind="in" today={today} />}
          {t?.hr_status && <p className="muted small" style={{ marginBottom: 0 }}>Marked by HR: {t.hr_status.replace("_", " ")}{t.hr_note ? ` (${t.hr_note})` : ""}</p>}
        </div>
      )}

      {active && <Reminders compact />}

      {active && (
        <div className="staff-card">
          <h2 style={{ marginBottom: 2 }}>Weekly off</h2>
          <p className="muted small" style={{ marginTop: 0 }}>Tap the day you&apos;re taking off (one day a week). Tap again to remove it.</p>
          <WeekOff weeks={weeks} today={today} />
        </div>
      )}

      {active && (
        <Link href="/my/attendance" className="staff-card" style={{ display: "block", color: "inherit" }}>
          <h2>{monthLabel(monthStart)}</h2>
          <div className="big">{present} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>days present so far</span></div>
          {offs > 0 && <div className="muted small">{offs} weekly off{offs > 1 ? "s" : ""} marked</div>}
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

const dayName = (day: string, today: string) => {
  const y = new Date(Date.parse(today + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);
  return day === y ? "yesterday" : new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};
