import Link from "next/link";
import { myDb, timeIST, todayIST, type MyDay } from "@/lib/my";
import { monthLabel, daysInMonth } from "@/lib/payroll";

const shift = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };

export default async function MyAttendance({ searchParams }: { searchParams: { m?: string } }) {
  const { sb, me } = await myDb();
  if (!me) return null;
  const today = todayIST();
  const m = /^\d{4}-\d{2}$/.test(searchParams.m || "") ? searchParams.m! : today.slice(0, 7);
  const from = `${m}-01`, to = `${m}-${String(daysInMonth(from)).padStart(2, "0")}`;
  const { data } = await sb.rpc("my_attendance", { p_from: from, p_to: to });
  const byDay = new Map(((data || []) as MyDay[]).map((d) => [d.day, d]));
  const days: string[] = [];
  for (let d = Math.min(daysInMonth(from), m === today.slice(0, 7) ? Number(today.slice(8)) : 31); d >= 1; d--) {
    const iso = `${m}-${String(d).padStart(2, "0")}`;
    if (iso <= to) days.push(iso);
  }
  const present = Array.from(byDay.values()).filter((d) => d.in_at || d.hr_status === "present" || d.hr_status === "half_day").length;

  return (
    <>
      <div className="staff-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link className="staff-btn" href={`?m=${shift(m, -1)}`} aria-label="Previous month">‹</Link>
        <div style={{ textAlign: "center" }}><b>{monthLabel(from)}</b><div className="muted small">{present} days present</div></div>
        {m < today.slice(0, 7) ? <Link className="staff-btn" href={`?m=${shift(m, 1)}`} aria-label="Next month">›</Link> : <span style={{ width: 44 }} />}
      </div>
      <div className="staff-card">
        {days.map((iso) => {
          const d = byDay.get(iso);
          const sunday = new Date(iso + "T00:00:00Z").getUTCDay() === 0;
          const label = new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
          return (
            <div className="staff-row" key={iso}>
              <span className="k">{label}</span>
              <span className="v">
                {d?.hr_status ? <span className={`pill ${d.hr_status === "absent" ? "bad" : "ok"}`}>{d.hr_status.replace("_", " ")} (HR)</span>
                  : d?.in_at ? <>{timeIST(d.in_at)}–{d.out_at ? timeIST(d.out_at) : "…"} {d.in_on_site === false && <span className="pill warn">away</span>}</>
                  : sunday ? <span className="muted">Sunday</span> : <span className="muted">–</span>}
              </span>
            </div>
          );
        })}
      </div>
      <p className="muted small">Missed a check-in? Tell HR the same day so they can mark it.</p>
    </>
  );
}
