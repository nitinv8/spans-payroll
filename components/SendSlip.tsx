"use client";
// "Send payslip" buttons. Browsers can't attach files to mailto: / wa.me links, so:
//  • On phones (and any browser that supports sharing files) → native share sheet with the PDF attached.
//  • Otherwise → download the PDF, then open the email app / WhatsApp with the recipient and message pre-filled.
import { useState } from "react";
import { monthLabel } from "@/lib/payroll";

export type Contact = { email: string | null; mobile: string | null };

const waNumber = (m: string | null) => {
  const d = (m || "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d || "";
};

export type SlipTarget = { lineId: string; name: string; month: string; netPay: number | null; contact: Contact };

/** Shared logic for downloading / emailing / WhatsApp-ing one payslip. */
export function useSlipSender({ lineId, name, month, netPay, contact }: SlipTarget) {
  const [busy, setBusy] = useState<"" | "email" | "wa" | "download">("");
  const [note, setNote] = useState("");
  const mLabel = monthLabel(month);
  const first = name.split(" ")[0];
  const amount = netPay != null ? `Rs. ${Math.round(Number(netPay)).toLocaleString("en-IN")}` : "";
  const subject = `Salary slip - ${mLabel} - Spans Envirotech`;
  const text = `Dear ${first},\n\nPlease find attached your salary slip for ${mLabel}.${amount ? `\nIn-hand salary: ${amount}` : ""}\n\nRegards,\nSpans Envirotech Pvt. Ltd.`;
  const filename = `Spans ${mLabel} Salary Slip - ${name}.pdf`;

  async function getFile() {
    const res = await fetch(`/api/lines/${lineId}/slip`);
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    return new File([blob], filename, { type: "application/pdf" });
  }

  function download(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function downloadOnly() {
    setBusy("download"); setNote("");
    try { download(await getFile()); }
    catch (e) { setNote(`Couldn't prepare the slip: ${(e as Error).message}`); }
    finally { setBusy(""); }
  }

  async function send(kind: "email" | "wa") {
    setBusy(kind); setNote("");
    // WhatsApp drops the message text when a file is shared to it, so copy the message first
    // (must happen right at the tap, before any await, or the browser blocks clipboard access).
    let copied = false;
    if (kind === "wa") {
      try { await navigator.clipboard.writeText(text); copied = true; } catch { copied = false; }
    }
    try {
      const file = await getFile();
      const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (touch && nav.canShare?.({ files: [file] })) {
        if (kind === "wa" && copied) setNote("Message copied. In WhatsApp, long-press the caption box → Paste, then send.");
        await navigator.share({ files: [file], title: subject, text });
        return;
      }
      download(file);
      if (kind === "email") {
        const mailto = `mailto:${encodeURIComponent(contact.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
        setTimeout(() => { window.location.href = mailto; }, 600); // let the download start first
        setNote("Slip downloaded – attach it to the email that opened.");
      } else {
        const num = waNumber(contact.mobile);
        const wa = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
        const w = window.open(wa, "_blank");
        if (!w) setTimeout(() => { window.location.href = wa; }, 600); // pop-up blocked: open in this tab
        setNote((num ? "Slip downloaded – drag it into the WhatsApp chat." : "No mobile number on file – pick the contact in WhatsApp, then attach the downloaded slip.")
          + (copied ? " If the message isn't there, paste it (Ctrl/Cmd+V) – it's copied." : ""));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote(`Couldn't prepare the slip: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }

  return { send, downloadOnly, busy, note, setNote };
}

export default function SendSlip({ compact = false, ...target }: SlipTarget & { compact?: boolean }) {
  const { send, busy, note } = useSlipSender(target);
  const { contact } = target;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => send("email")}
          title={contact.email ? `Email to ${contact.email}` : "No email on file – you can type one in"}>
          {busy === "email" ? "…" : compact ? "Email" : "Send by email"}
        </button>
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => send("wa")}
          title={contact.mobile ? `WhatsApp to ${contact.mobile}` : "No mobile on file – you can pick the contact"}>
          {busy === "wa" ? "…" : compact ? "WhatsApp" : "Send by WhatsApp"}
        </button>
      </span>
      {note && <span className="small muted" style={{ whiteSpace: "normal", maxWidth: 220 }}>{note}</span>}
    </span>
  );
}
