"use client";
// Weekly off: tap a day this week or next week to mark it as your weekly off (one per Monday–Sunday week); tap again to remove.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export type WeekDay = { day: string; off: boolean; worked: boolean; hr: boolean };

export default function WeekOff({ weeks, today }: { weeks: { label: string; days: WeekDay[] }[]; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function toggle(d: WeekDay) {
    setErr(""); setBusy(d.day);
    const { error } = await supabaseBrowser().rpc("attendance_week_off", { p_day: d.day, p_on: !d.off });
    setBusy("");
    if (error) setErr(error.message); else router.refresh();
  }

  return (
    <div>
      {weeks.map((w) => (
        <div key={w.label} style={{ marginBottom: 10 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>{w.label}</div>
          <div className="weekoff">
            {w.days.map((d) => {
              const dt = new Date(d.day + "T00:00:00Z");
              const locked = d.worked || d.hr || d.day < addDays(today, -7);
              return (
                <button key={d.day} type="button" className={`wo${d.off ? " on" : ""}${d.day === today ? " today" : ""}`}
                  disabled={locked || !!busy} onClick={() => toggle(d)}
                  title={d.worked ? "You checked in on this day" : d.hr ? "Marked by HR" : d.off ? "Tap to remove weekly off" : "Tap to mark as weekly off"}
                  aria-pressed={d.off}>
                  <span>{dt.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}</span>
                  <b>{dt.getUTCDate()}</b>
                  {d.off && <small>Off</small>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {err && <div className="notice bad" style={{ marginTop: 6, marginBottom: 0 }}>{err}</div>}
    </div>
  );
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
