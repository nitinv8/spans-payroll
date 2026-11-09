// Turning check-ins into payroll days (pure; used by the payroll "Fill days from attendance" page and tests).
import { daysInMonth } from "./payroll";

export type AttRow = { day: string; in_at: string | null; in_on_site?: boolean | null; hr_status: string | null; self_status?: string | null };
export type Suggestion = {
  working_days: number; paid_offs: number; leaves: number; lop_days: number;
  present: number; away: number; first_day: string | null; future_days: number;
};

/**
 * For each day the person was employed:
 *   HR mark wins (present 1 · half day ½ worked + ½ LOP · absent LOP · leave paid leave · holiday paid off);
 *   otherwise a check-in = worked; a weekly off the employee marked = paid off;
 *   no check-in on a Sunday = weekly off, unless they marked another day of that Monday–Sunday week as their weekly off; otherwise LOP.
 * Days not employed are LOP. Days after `today` are assumed normal (worked; their marked weekly off or else Sunday off).
 * Pass rows for a few days either side of the month so weeks that cross the month boundary are seen whole.
 */
export function suggestDays(e: { date_of_joining: string | null; date_of_leaving: string | null }, month: string, rows: AttRow[], today: string): Suggestion {
  const dim = daysInMonth(month);
  const ym = month.slice(0, 7);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const weekOf = (iso: string) => { const t = Date.parse(iso + "T00:00:00Z"); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
  const markedWeeks = new Set(rows.filter((r) => r.self_status === "week_off" && !r.in_at && !r.hr_status).map((r) => weekOf(r.day)));
  const s: Suggestion = { working_days: 0, paid_offs: 0, leaves: 0, lop_days: 0, present: 0, away: 0, first_day: null, future_days: 0 };
  for (let d = 1; d <= dim; d++) {
    const iso = `${ym}-${String(d).padStart(2, "0")}`;
    if ((e.date_of_joining && iso < e.date_of_joining) || (e.date_of_leaving && iso > e.date_of_leaving)) { s.lop_days++; continue; }
    const sunday = new Date(iso + "T00:00:00Z").getUTCDay() === 0 && !markedWeeks.has(weekOf(iso));
    const r = byDay.get(iso);
    if (r?.in_at || r?.hr_status === "present" || r?.hr_status === "half_day") { s.first_day ??= iso; }
    if (r?.hr_status) {
      if (r.hr_status === "present") { s.working_days++; s.present++; }
      else if (r.hr_status === "half_day") { s.working_days += 0.5; s.lop_days += 0.5; s.present += 0.5; }
      else if (r.hr_status === "absent") s.lop_days++;
      else if (r.hr_status === "leave") s.leaves++;
      else if (r.hr_status === "holiday") s.paid_offs++;
    } else if (r?.in_at) {
      s.working_days++; s.present++;
      if (r.in_on_site === false) s.away++;
    } else if (r?.self_status === "week_off") {
      s.paid_offs++; if (iso > today) s.future_days++;
    } else if (iso > today) {
      s.future_days++;
      if (sunday) s.paid_offs++; else s.working_days++;
    } else if (sunday) s.paid_offs++;
    else s.lop_days++;
  }
  return s;
}
