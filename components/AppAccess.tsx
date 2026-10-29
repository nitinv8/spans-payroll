"use client";
// HR: give an employee access to the employee app (mobile + PIN) and share the PIN once.
import { useState } from "react";
import { setEmployeePin } from "@/app/actions";
import { waNumber } from "@/lib/contact";

export default function AppAccess({ employeeId, name, mobile, enabled }: { employeeId: string; name: string; mobile: string | null; enabled: boolean }) {
  const [pin, setPin] = useState("");
  const [shown, setShown] = useState<{ pin: string; mobile: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await setEmployeePin(employeeId, pin || undefined);
    setBusy(false);
    if (r.ok) { setShown({ pin: r.pin, mobile: r.mobile }); setPin(""); } else setErr(r.error);
  }

  const link = typeof window !== "undefined" ? `${window.location.origin}/my` : "/my";
  const msg = shown ? `Hi ${name.split(" ")[0]}, you can now use the Spans staff app for attendance and payslips.\n\nOpen: ${link}\nMobile: ${shown.mobile}\nPIN: ${shown.pin}\n\nPlease don't share your PIN.` : "";

  return (
    <div>
      {shown ? (
        <div className="notice ok" style={{ marginBottom: 10 }}>
          <div>New PIN for {name}: <b className="mono" style={{ fontSize: 18, letterSpacing: 2 }}>{shown.pin}</b> (login: mobile {shown.mobile})</div>
          <div className="small" style={{ margin: "4px 0 8px" }}>It won&apos;t be shown again. Send it to them now.</div>
          <div className="row">
            {waNumber(mobile) && <a className="btn sm primary" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${waNumber(mobile)}?text=${encodeURIComponent(msg)}`}>Send on WhatsApp</a>}
            <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(msg)}>Copy message</button>
          </div>
        </div>
      ) : null}
      <form onSubmit={go} className="row" style={{ alignItems: "end" }}>
        <div>
          <label htmlFor="pin">{enabled ? "New PIN (leave blank for a random one)" : "PIN (leave blank for a random one)"}</label>
          <input id="pin" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} style={{ width: 170 }} />
        </div>
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : enabled ? "Reset PIN" : "Give app access"}</button>
      </form>
      {err && <div className="notice bad" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
