import Link from "next/link";
import { pageDb, fmtDate } from "@/lib/data";
import { daysInMonth, monthLabel } from "@/lib/payroll";
import { sortEmployees, type Employee } from "@/lib/run-logic";
import { mapsLink } from "@/lib/geo";
import { markAttendance } from "@/app/actions";

export const dynamic = "force-dynamic";

const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "");
const shift = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const HR_LABEL: Record<string, [string, string]> = {
  present: ["P", "Present (HR)"], half_day: ["½", "Half day (HR)"], absent: ["A", "Absent (HR)"], leave: ["L", "Leave (HR)"], holiday: ["H", "Holiday (HR)"],
};
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default async function Attendance({ searchParams }: { searchParams: { m?: string; e?: string; d?: string } }) {
  const { sb } = await pageDb();
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const m = /^\d{4}-\d{2}$/.test(searchParams.m || "") ? searchParams.m! : today.slice(0, 7);
  const first = `${m}-01`, dim = daysInMonth(first), last = `${m}-${String(dim).padStart(2, "0")}`;

  // Selfies are kept for 90 days: clear older ones whenever this page is opened
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const { data: old } = await sb.from("attendance").select("id, in_photo, out_photo").lt("day", cutoff).or("in_photo.not.is.null,out_photo.not.is.null").limit(500);
  if (old?.length) {
    const paths = old.flatMap((r) => [r.in_photo, r.out_photo]).filter(Boolean) as string[];
    const { error } = await sb.storage.from("attendance").remove(paths);
    if (!error) await sb.from("attendance").update({ in_photo: null, out_photo: null }).in("id", old.map((r) => r.id));
  }

  const [{ data: emps }, { data: rows }, { data: sites }] = await Promise.all([
    sb.from("employees").select("*"),
    sb.from("attendance").select("*").gte("day", first).lte("day", last),
    sb.from("sites").select("id, name"),
  ]);
  const siteName = (id: string | null) => sites?.find((s) => s.id === id)?.name ?? null;
  const withRows = new Set((rows || []).map((r) => r.employee_id));
  const people = sortEmployees(((emps || []) as Employee[]).filter((e) =>
    withRows.has(e.id) || (e.status === "Active" && (!e.date_of_joining || e.date_of_joining <= last))));
  const at = new Map((rows || []).map((r) => [`${r.employee_id}|${r.day}`, r as Row]));
  const days = Array.from({ length: dim }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
  const isSun = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay() === 0;

  // Selected day
  const sel = searchParams.e && searchParams.d ? at.get(`${searchParams.e}|${searchParams.d}`) ?? null : null;
  const selEmp = searchParams.e ? people.find((p) => p.id === searchParams.e) ?? (emps || []).find((p) => p.id === searchParams.e) : null;
  let photos: Record<string, string> = {};
  if (sel && (sel.in_photo || sel.out_photo)) {
    const paths = [sel.in_photo, sel.out_photo].filter(Boolean) as string[];
    const { data: signed } = await sb.storage.from("attendance").createSignedUrls(paths, 3600);
    photos = Object.fromEntries((signed || []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  }

  const count = (eid: string) => {
    let present = 0, away = 0, missing = 0;
    for (const d of days) {
      const r = at.get(`${eid}|${d}`);
      if (r?.hr_status === "present") present++;
      else if (r?.hr_status === "half_day") present += 0.5;
      else if (r?.in_at && !r.hr_status) { present++; if (r.in_on_site === false) away++; }
      else if (!r && d <= today && !isSun(d)) missing++;
    }
    return { present, away, missing };
  };

  const Punch = ({ label, r, k }: { label: string; r: Row; k: "in" | "out" }) => !r[`${k}_at`] ? null : (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {r[`${k}_photo`] && photos[r[`${k}_photo`]]
        ? <a href={photos[r[`${k}_photo`]]} target="_blank" rel="noopener noreferrer"><img className="selfie" src={photos[r[`${k}_photo`]]} alt={`${label} selfie`} /></a>
        : <div className="selfie" style={{ display: "grid", placeItems: "center" }}><span className="muted small">{r[`${k}_photo`] ? "Photo unavailable" : "Photo deleted (90 days)"}</span></div>}
      <div>
        <div><b>{label} {ist(r[`${k}_at`])}</b></div>
        <div>{r[`${k}_on_site`] ? <span className="badge ok">on site</span> : <span className="badge warn">away from site</span>}{" "}
          {siteName(r[`${k}_site_id`]) && <span className="small">{r[`${k}_on_site`] ? "" : "nearest: "}{siteName(r[`${k}_site_id`])} · {r[`${k}_distance_m`]} m</span>}</div>
        <div className="small muted">GPS accuracy ±{Math.round(r[`${k}_accuracy`] || 0)} m</div>
        {mapsLink(r[`${k}_lat`], r[`${k}_lng`]) && <a className="small" href={mapsLink(r[`${k}_lat`], r[`${k}_lng`])!} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>}
      </div>
    </div>
  );

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Attendance</h1>
          <div className="muted">Check-ins from the staff app (selfie + location). Click a day to see details or mark it.</div>
        </div>
        <div className="row">
          <Link className="btn" href={`?m=${shift(m, -1)}`}>‹ {monthLabel(`${shift(m, -1)}-01`)}</Link>
          <b style={{ padding: "0 6px" }}>{monthLabel(first)}</b>
          {m < today.slice(0, 7) && <Link className="btn" href={`?m=${shift(m, 1)}`}>{monthLabel(`${shift(m, 1)}-01`)} ›</Link>}
          <Link className="btn" href="/attendance/sites">Sites</Link>
        </div>
      </div>

      {selEmp && searchParams.d && (
        <div className="panel" id="day">
          <div className="pagehead" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>{selEmp.name} · {fmtDate(searchParams.d)}</h2>
            <Link className="btn sm" href={`?m=${m}`}>Close</Link>
          </div>
          {sel?.in_at ? (
            <div className="row" style={{ gap: 28, alignItems: "flex-start" }}><Punch label="In" r={sel} k="in" /><Punch label="Out" r={sel} k="out" /></div>
          ) : <p className="muted">No check-in from the app on this day.</p>}
          {sel?.in_at && !sel.out_at && <p className="muted small">No check-out recorded.</p>}
          <form action={markAttendance} className="row" style={{ alignItems: "end", marginTop: 14 }}>
            <input type="hidden" name="employee_id" value={selEmp.id} /><input type="hidden" name="day" value={searchParams.d} />
            <div><label htmlFor="hr_status">HR mark</label>
              <select id="hr_status" name="hr_status" defaultValue={sel?.hr_status || ""}>
                <option value="">None (use the app record)</option>
                <option value="present">Present</option><option value="half_day">Half day</option><option value="absent">Absent (LOP)</option>
                <option value="leave">Paid leave</option><option value="holiday">Holiday / paid off</option>
              </select></div>
            <div style={{ minWidth: 320, flex: 1 }}><label htmlFor="hr_note">Reason (required for a mark)</label>
              <input id="hr_note" name="hr_note" defaultValue={sel?.hr_note || ""} placeholder="e.g. Phone not working, site in-charge confirmed" /></div>
            <button className="btn primary">Save</button>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="row small muted" style={{ marginBottom: 8, gap: 14 }}>
          <span><span className="badge ok">✓</span> on site</span><span><span className="badge warn">!</span> away from site</span>
          <span><span className="badge">P ½ A L H</span> marked by HR</span><span>· no check-in</span><span style={{ background: "#f3f4f6", padding: "0 6px" }}>Sunday</span>
        </div>
        {!people.length ? <p className="muted">No active employees.</p> : (
          <div className="tablewrap">
            <table className="attgrid">
              <thead><tr>
                <th className="name">Employee</th>
                {days.map((d) => <th key={d} className={isSun(d) ? "sun" : ""}>{Number(d.slice(8))}</th>)}
                <th className="num" style={{ paddingLeft: 10 }}>Present</th><th className="num">Away</th><th className="num">No check-in</th>
              </tr></thead>
              <tbody>
                {people.map((p) => {
                  const c = count(p.id);
                  return (
                    <tr key={p.id}>
                      <td className="name"><Link href={`/employees/${p.id}`}>{p.name}</Link>{!(p as Row).app_access && <div className="small muted">no app access</div>}</td>
                      {days.map((d) => {
                        const r = at.get(`${p.id}|${d}`);
                        const hr = r?.hr_status ? HR_LABEL[r.hr_status] : null;
                        const cls = hr ? "hr" : r?.in_at ? (r.in_on_site === false ? "away" : "on") : "miss";
                        const txt = hr ? hr[0] : r?.in_at ? (r.in_on_site === false ? "!" : "✓") : d > today ? "" : isSun(d) ? "" : "·";
                        const title = hr ? `${hr[1]}: ${r!.hr_note}` : r?.in_at ? `In ${ist(r.in_at)}${r.out_at ? `, out ${ist(r.out_at)}` : ""}` : "No check-in";
                        const selCls = searchParams.e === p.id && searchParams.d === d ? " sel" : "";
                        return <td key={d} className={isSun(d) ? "sun" : ""}>
                          {d <= today ? <Link className={`c ${cls}${selCls}`} title={title} href={`?m=${m}&e=${p.id}&d=${d}#day`}>{txt}</Link> : null}
                        </td>;
                      })}
                      <td className="num" style={{ paddingLeft: 10 }}><b>{c.present}</b></td><td className="num">{c.away || ""}</td><td className="num">{c.missing || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
