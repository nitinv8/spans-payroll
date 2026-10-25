"use client";
// Compact "⋮" actions menu for a payroll row: details, download slip, email, WhatsApp.
import { useEffect, useRef, useState } from "react";
import { useSlipSender, type SlipTarget } from "./SendSlip";

export default function RowMenu({ target, detailsOpen, onToggleDetails, onNote, disabled }: {
  target: SlipTarget; detailsOpen: boolean; onToggleDetails: () => void; onNote: (msg: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  // Fixed positioning so the menu isn't clipped by the scrolling table; open upwards near the bottom of the screen
  const toggle = () => {
    if (!open && btn.current) {
      const r = btn.current.getBoundingClientRect();
      const h = 210;
      const top = window.innerHeight - r.bottom < h + 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
      setPos({ top, left: Math.min(r.left, window.innerWidth - 248) });
    }
    setOpen(!open);
  };
  const { send, downloadOnly, busy, note } = useSlipSender(target);

  useEffect(() => { if (note) onNote(note); }, [note, onNote]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const shut = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", shut, true); window.removeEventListener("resize", shut);
    };
  }, [open]);

  const act = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="rowmenu" ref={ref}>
      <button ref={btn} type="button" className="rowmenu-btn" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Actions for ${target.name}`} onClick={toggle}>
        {busy ? "…" : "⋮"}
      </button>
      {open && (
        <div className="rowmenu-list" role="menu" style={{ top: pos.top, left: pos.left }}>
          <button role="menuitem" type="button" onClick={act(onToggleDetails)}>{detailsOpen ? "Hide details" : "View details"}</button>
          <button role="menuitem" type="button" disabled={disabled} onClick={act(downloadOnly)}>Download slip (PDF)</button>
          <button role="menuitem" type="button" disabled={disabled} onClick={act(() => send("email"))}>
            Send by email
          </button>
          <button role="menuitem" type="button" disabled={disabled} onClick={act(() => send("wa"))}>
            Send by WhatsApp
          </button>
        </div>
      )}
    </div>
  );
}
