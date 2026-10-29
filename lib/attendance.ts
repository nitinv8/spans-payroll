// Turning check-ins into payroll days (pure; used by the payroll "Fill days from attendance" page and tests).
import { daysInMonth } from "./payroll";

export type AttRow = { day: string; in_at: string | null; in_on_site?: boolean | null; hr_status: string | null };
export type Suggestion = {
  working_days: number; paid_offs: number; leaves: number; lop_days: number;
  present: number; away: number; first_day: string | null; future_days: number;
};

/**
 * For each day the person was employed:
 *   HR mark wins (present 1 · half day ½ worked + ½ LOP · absent LOP · leave paid leave · holiday paid off);
 *   otherwise a check-in = worked; no check-in on a Sunday = weekly off; otherwise LOP.
 * Days not employed are LOP. Days after `today` are assumed normal (worked, Sundays off).
 */
export function suggestDays(e: { date_of_joining: string | null; date_of_leaving: string | null }, month: string, rows: AttRow[], today: string): Suggestion {
  const dim = daysInMonth(month);
  const ym = month.slice(0, 7);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const s: Suggestion = { working_days: 0, paid_offs: 0, leaves: 0, lop_days: 0, present: 0, away: 0, first_day: null, future_days: 0 };
  for (let d = 1; d <= dim; d++) {
    const iso = `${ym}-${String(d).padStart(2, "0")}`;
    if ((e.date_of_joining && iso < e.date_of_joining) || (e.date_of_leaving && iso > e.date_of_leaving)) { s.lop_days++; continue; }
    const sunday = new Date(iso + "T00:00:00Z").getUTCDay() === 0;
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
    } else if (iso > today) {
      s.future_days++;
      if (sunday) s.paid_offs++; else s.working_days++;
    } else if (sunday) s.paid_offs++;
    else s.lop_days++;
  }
  return s;
}
