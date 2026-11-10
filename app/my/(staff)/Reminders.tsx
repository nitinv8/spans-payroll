"use client";
// Turn attendance reminders on/off for this phone (web push).
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sendMeTestReminder } from "../actions";

type State = "loading" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function keyBytes(b64: string) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const device = () => {
  const ua = navigator.userAgent;
  return (isIOS() ? "iPhone" : /android/i.test(ua) ? "Android" : "Computer") + (/chrome|crios/i.test(ua) ? " · Chrome" : /safari/i.test(ua) ? " · Safari" : "");
};

export default function Reminders({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !KEY) {
        setState(isIOS() && !standalone() ? "ios-install" : "unsupported"); return;
      }
      if (Notification.permission === "denied") { setState("blocked"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setState("off"); return; }
      const { data } = await supabaseBrowser().rpc("my_push_status", { p_endpoint: sub.endpoint });
      setState(data ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setBusy(true); setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) });
      const j = sub.toJSON();
      const { error } = await supabaseBrowser().rpc("my_push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_device: device() });
      if (error) throw new Error(error.message);
      setState("on");
      const r = await sendMeTestReminder();
      setMsg(r.error ? r.error : "Reminders are on. You should see a test notification now.");
    } catch (e) {
      setMsg((e as Error).message || "Couldn't turn on reminders.");
    } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true); setMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await supabaseBrowser().rpc("my_push_unsubscribe", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setState("off");
    } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg("");
    const r = await sendMeTestReminder();
    setMsg(r.error || "Sent. It should appear in a few seconds.");
    setBusy(false);
  }

  if (state === "loading" || (compact && state === "on")) return null;
  return (
    <div className="staff-card">
      <h2 style={{ marginBottom: 4 }}>Attendance reminders</h2>
      {state === "on" && <>
        <p className="muted small" style={{ marginTop: 0 }}>On for this phone. You&apos;ll get a reminder at 10 AM if you haven&apos;t checked in, and one if you forget to check out.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="staff-btn primary" onClick={test} disabled={busy}>Send a test</button>
          <button type="button" className="staff-btn" onClick={turnOff} disabled={busy}>Turn off</button>
        </div>
      </>}
      {state === "off" && <>
        <p className="muted small" style={{ marginTop: 0 }}>Get a reminder at 10 AM if you haven&apos;t checked in, and one if you forget to check out.</p>
        <button type="button" className="staff-btn primary" onClick={turnOn} disabled={busy} style={{ width: "100%", justifyContent: "center" }}>{busy ? "Turning on…" : "Turn on reminders"}</button>
      </>}
      {state === "ios-install" && <p className="small" style={{ margin: 0 }}>
        To get reminders on iPhone, add this app to your home screen first: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. Open Spans Payroll from the home screen and turn reminders on there.
      </p>}
      {state === "blocked" && <p className="small" style={{ margin: 0 }}>
        Notifications are blocked for this app. Turn them on in your phone&apos;s settings (Settings → Notifications), then come back here.
      </p>}
      {state === "unsupported" && <p className="muted small" style={{ margin: 0 }}>This browser can&apos;t show reminders. On Android, use Chrome. On iPhone, add the app to your home screen from Safari.</p>}
      {msg && <div className="notice ok" style={{ marginTop: 10, marginBottom: 0 }}>{msg}</div>}
    </div>
  );
}
