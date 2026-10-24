"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function PasswordForm() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <form className="row" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (pw.length < 10) return setMsg("Use at least 10 characters.");
      const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
      setMsg(error ? error.message : "Password changed."); setPw("");
    }}>
      <div><label htmlFor="newpw">New password</label><input id="newpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
      <button className="btn">Change password</button>
      {msg && <span className="small muted">{msg}</span>}
    </form>
  );
}
