"use client";
// Shows Aadhaar / PAN / bank account masked. "Reveal" fetches the full value (logged in the audit trail)
// and turns it into an editable field. If never revealed, the form doesn't send it, so saving can't erase it.
import { useState } from "react";
import { revealSensitive } from "@/app/actions";


export default function SensitiveField({ name, label, employeeId, masked }: {
  name: "aadhaar" | "pan" | "bank_account"; label: string; employeeId?: string; masked: string;
}) {
  // New employee (no id): plain input
  const [value, setValue] = useState<string | null>(employeeId ? null : "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function reveal() {
    if (!employeeId) return;
    setBusy(true); setErr("");
    const r = await revealSensitive(employeeId, name);
    setBusy(false);
    if (r.ok) setValue(r.value); else setErr(r.error);
  }

  return (
    <div>
      <label htmlFor={name}>{label}</label>
      {value === null ? (
        <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
          <input id={name} value={masked || "Not entered"} readOnly aria-readonly="true" style={{ background: "var(--soft)" }} />
          <button type="button" className="btn sm" onClick={reveal} disabled={busy} title="Show full value (recorded in the audit log)">
            {busy ? "…" : "Reveal"}
          </button>
        </div>
      ) : (
        <input id={name} name={name} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
      )}
      {err && <div className="small" style={{ color: "var(--bad)" }}>{err}</div>}
    </div>
  );
}
