"use client";
import { useState } from "react";

/** Fills the location box with this device's position (use it while standing at the site). */
export default function UseMyLocation({ target }: { target: string }) {
  const [msg, setMsg] = useState("");
  return (
    <span>
      <button type="button" className="btn sm" onClick={() => {
        setMsg("Getting location…");
        navigator.geolocation?.getCurrentPosition(
          (p) => {
            const el = document.getElementById(target) as HTMLInputElement | null;
            if (el) el.value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`;
            setMsg(`Accuracy about ${Math.round(p.coords.accuracy)} m`);
          },
          () => setMsg("Location not available on this device"), { enableHighAccuracy: true, timeout: 20000 });
      }}>Use my current location</button>
      {msg && <span className="muted small" style={{ marginLeft: 8 }}>{msg}</span>}
    </span>
  );
}
