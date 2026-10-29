// Employee logins (mobile number + 6-digit PIN). Server only.
// Each employee gets their own Supabase login: email m<mobile>@staff.spans.co.in (never emailed) and a password derived
// from the PIN with a server-side secret, so the stored password is long and random and the PIN alone is useless
// outside this app. Creating and changing these logins needs the Supabase service key (Vercel env only).
import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { OpError } from "./ops";

export const mobile10 = (m: string | null | undefined) => {
  const d = (m || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};
export const staffEmail = (m10: string) => `m${m10}@staff.spans.co.in`;

function secret() {
  const s = process.env.EMPLOYEE_PIN_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new OpError("Employee logins aren't set up yet: add SUPABASE_SERVICE_ROLE_KEY in Vercel (see README).");
  return s;
}

/** The Supabase password for a mobile + PIN. */
export const pinPassword = (m10: string, pin: string) =>
  `Sp1-${createHmac("sha256", secret()).update(`${m10}:${pin}`).digest("base64url")}`;

export function checkPin(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new OpError("The PIN must be 6 digits.");
  if (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) throw new OpError("Pick a less obvious PIN.");
}

export const newPin = () => {
  for (;;) {
    const p = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try { checkPin(p); return p; } catch { /* try again */ }
  }
};

/** Supabase admin client (service key). */
export function adminDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new OpError("Employee logins aren't set up yet: add SUPABASE_SERVICE_ROLE_KEY in Vercel (see README).");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
