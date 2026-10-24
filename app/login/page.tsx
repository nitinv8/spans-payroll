"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setErr(error.message);
    window.location.href = "/";
  }

  async function reset() {
    if (!email) return setErr("Enter your email first.");
    setErr("");
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` });
    setMsg(error ? error.message : "If this email has access, a reset link has been sent.");
  }

  return (
    <div className="loginwrap">
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
    </div>
  );
}
