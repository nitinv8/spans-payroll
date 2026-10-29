"use client";
import { useState } from "react";
import { monthLabel } from "@/lib/payroll";

export default function SlipShare({ lineId, month, name }: { lineId: string; month: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const url = `/api/my/slip/${lineId}`;
  const filename = `Spans ${monthLabel(month)} Salary Slip - ${name}.pdf`;
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare;

  async function share() {
    setBusy(true); setErr("");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const file = new File([await res.blob()], filename, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: filename });
      else window.location.href = url;
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr("Couldn't share. Try Download instead.");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8 }}>
        <a className="staff-btn primary" style={{ flex: 1 }} href={url}>Download PDF</a>
        {canShare && <button type="button" className="staff-btn" style={{ flex: 1 }} onClick={share} disabled={busy}>{busy ? "…" : "Share"}</button>}
      </div>
      {err && <div className="notice bad" style={{ marginTop: 8, marginBottom: 0 }}>{err}</div>}
    </div>
  );
}
