"use client";
// Check in / check out: selfie (front camera) + GPS location, then the server records the time and nearest site.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Fix = { lat: number; lng: number; accuracy: number };

function locate(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This phone's browser can't share location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1
        ? "Location is blocked. Allow location for this site in your browser settings, then try again."
        : "Couldn't get your location. Turn on location (GPS) and try again.")),
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
  });
}

/** Shrinks the photo to about 480 px wide JPEG (~30–60 KB) so it uploads quickly on mobile data. */
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 480 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), "image/jpeg", 0.7));
}

export default function Punch({ employeeId, kind, today }: { employeeId: string; kind: "in" | "out"; today: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const fix = useRef<Promise<Fix> | null>(null);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  function start() {
    setErr(""); setDone("");
    fix.current = locate();             // ask for location while the camera opens
    fix.current.catch(() => undefined); // handled after the photo
    input.current?.click();
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setStep("Getting your location…");
      const where = await (fix.current || locate());
      setStep("Saving…");
      const photo = await shrink(file);
      const sb = supabaseBrowser();
      const path = `${employeeId}/${today}-${kind}-${Date.now()}.jpg`;
      const up = await sb.storage.from("attendance").upload(path, photo, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error("Couldn't upload the selfie. Check your internet and try again.");
      const { data, error } = await sb.rpc("attendance_punch", { p_kind: kind, p_lat: where.lat, p_lng: where.lng, p_accuracy: where.accuracy, p_photo: path });
      if (error) throw new Error(error.message);
      const r = data as { at: string; site: string | null; on_site: boolean; distance_m: number | null };
      const t = new Date(r.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
      setDone(`${kind === "in" ? "Checked in" : "Checked out"} at ${t}` + (r.site ? (r.on_site ? ` · ${r.site}` : ` · away from site (${r.site} is ${km(r.distance_m)} away)`) : ""));
      router.refresh();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setStep("");
    }
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="user" onChange={onPhoto} hidden />
      <button type="button" className={`punch ${kind === "out" ? "out" : ""}`} onClick={start} disabled={!!step}>
        {step || (kind === "in" ? "Check in" : "Check out")}
        {!step && <small>Takes a selfie and your location</small>}
      </button>
      {err && <div className="notice bad" style={{ marginTop: 10, marginBottom: 0 }}>{err}</div>}
      {done && <div className="notice ok" style={{ marginTop: 10, marginBottom: 0 }}>{done}</div>}
    </div>
  );
}

const km = (m: number | null) => (m == null ? "?" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
