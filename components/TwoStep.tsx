"use client";
// Two-step login (TOTP authenticator app) – enrol, verify, remove. Uses Supabase Auth MFA.
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string };

export default function TwoStep() {
  const sb = supabaseBrowser();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await sb.auth.mfa.listFactors();
    setFactors(((data?.all || []) as Factor[]).filter((f) => f.factor_type === "totp"));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const verified = (factors || []).filter((f) => f.status === "verified");

  async function start() {
    setBusy(true); setMsg("");
    // clear half-finished enrolments first
    for (const f of (factors || []).filter((x) => x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Spans Payroll ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data || data.type !== "totp") return setMsg(error?.message || "Couldn't start set-up");
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    if (!enrol) return;
    setBusy(true); setMsg("");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enrol.id, code: code.trim() });
    setBusy(false);
    if (error) return setMsg(error.message);
    setEnrol(null); setCode(""); setMsg("Two-step login is on. You'll be asked for a code each time you sign in.");
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Turn off two-step login? Anyone with your password could then sign in.")) return;
    const { error } = await sb.auth.mfa.unenroll({ factorId: id });
    setMsg(error ? error.message : "Two-step login turned off.");
    await load();
  }

  if (factors === null) return <p className="muted small">Loading…</p>;
  return (
    <div>
      {verified.length ? (
        <>
          <p style={{ marginTop: 0 }}><span className="badge ok">On</span> A code from your authenticator app is needed at every sign-in.</p>
          {verified.map((f) => (
            <div key={f.id} className="row" style={{ justifyContent: "space-between" }}>
              <span className="small">{f.friendly_name || "Authenticator app"}</span>
              <button type="button" className="btn sm danger" onClick={() => remove(f.id)}>Turn off</button>
            </div>
          ))}
        </>
      ) : enrol ? (
        <form onSubmit={confirmCode}>
          <p style={{ marginTop: 0 }}>1. Scan this QR code with Google Authenticator, Microsoft Authenticator or similar.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: "#fff", borderRadius: 8 }} />
          <p className="small muted">Can&apos;t scan? Enter this key: <span className="mono">{enrol.secret}</span></p>
          <p>2. Enter the 6-digit code it shows:</p>
          <div className="row">
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ width: 120 }} aria-label="6-digit code" required />
            <button className="btn primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Turn on"}</button>
            <button type="button" className="btn" onClick={() => setEnrol(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p style={{ marginTop: 0 }}><span className="badge warn">Off</span> Recommended: payroll holds bank, PAN and Aadhaar details.</p>
          <button type="button" className="btn primary" onClick={start} disabled={busy}>{busy ? "…" : "Set up two-step login"}</button>
        </>
      )}
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
