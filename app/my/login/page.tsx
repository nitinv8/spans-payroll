"use client";
import { useState } from "react";
import { employeeSignIn } from "../actions";

export default function StaffLogin() {
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await employeeSignIn(mobile, pin);
    if (r.error) { setBusy(false); setPin(""); return setErr(r.error); }
    window.location.href = "/my";
  }

  return (
    <div className="staff-main" style={{ paddingTop: 48 }}>
      <form className="staff-card" onSubmit={submit} style={{ padding: 22 }}>
        <div className="muted small">Spans Envirotech</div>
        <h1 style={{ margin: "2px 0 16px" }}>Staff sign in</h1>
        <label htmlFor="mobile">Mobile number</label>
        <input id="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile" required
          value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d ]/g, ""))} style={{ marginBottom: 14 }} />
        <label htmlFor="pin">6-digit PIN</label>
        <input id="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{6}" maxLength={6} required
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} style={{ marginBottom: 16, letterSpacing: 6 }} />
        {err && <div className="notice bad">{err}</div>}
        <button className="staff-btn primary" style={{ width: "100%" }} disabled={busy || pin.length !== 6}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted small" style={{ marginBottom: 0 }}>Forgot your PIN? Ask HR to set a new one.</p>
      </form>
    </div>
  );
}
