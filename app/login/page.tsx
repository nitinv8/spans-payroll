"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Signed in with password but two-step code still needed (e.g. after a page reload)
  const needsCode = async () => {
    const { data } = await supabaseBrowser().auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
  };
  useEffect(() => { needsCode().then((n) => n && setStep("code")); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); return setErr(error.message); }
    if (await needsCode()) { setBusy(false); setStep("code"); return; }
    window.location.href = "/";
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const sb = supabaseBrowser();
    const { data } = await sb.auth.mfa.listFactors();
    const factor = data?.totp?.find((f) => f.status === "verified");
    if (!factor) { setBusy(false); return setErr("No authenticator app is set up for this login."); }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setBusy(false);
    if (error) return setErr(error.message === "Invalid TOTP code entered" ? "That code didn't match. Try the latest code from your app." : error.message);
    window.location.href = "/";
  }

  async function reset() {
    if (!email) return setErr("Enter your email first.");
    setErr("");
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` });
    setMsg(error ? error.message : "If this email has access, a reset link has been sent.");
  }

  async function startOver() {
    await supabaseBrowser().auth.signOut();
    setStep("password"); setCode(""); setErr("");
  }

  return (
    <div className="loginwrap">
      {step === "password" ? (
        <form className="login" onSubmit={submit}>
          <h1>Spans Payroll</h1>
          <p className="muted" style={{ marginTop: 0 }}>Sign in to continue</p>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {err && <div className="notice bad">{err}</div>}
          {msg && <div className="notice ok">{msg}</div>}
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" className="btn sm" style={{ marginTop: 10, border: 0, background: "none", color: "var(--muted)" }} onClick={reset}>
            Forgot password?
          </button>
        </form>
      ) : (
        <form className="login" onSubmit={submitCode}>
          <h1>Enter your code</h1>
          <p className="muted" style={{ marginTop: 0 }}>Open your authenticator app and type the 6-digit code for Spans Payroll.</p>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="code">6-digit code</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </div>
          {err && <div className="notice bad">{err}</div>}
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Continue"}
          </button>
          <button type="button" className="btn sm" style={{ marginTop: 10, border: 0, background: "none", color: "var(--muted)" }} onClick={startOver}>
            Use a different account
          </button>
        </form>
      )}
    </div>
  );
}
