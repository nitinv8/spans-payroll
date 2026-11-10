// Web push to the staff app. Server only: uses the VAPID private key and the Supabase service key.
import "server-only";
import webpush from "web-push";
import { adminDb } from "./employee-auth";
import { OpError } from "./ops";

export type PushMessage = { title: string; body: string; url?: string; tag?: string };
export type SendResult = { people: number; phones: number; sent: number; failed: number; noPhone: string[] };

export const pushReady = () => !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function setup() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new OpError("Reminders aren't set up yet: the VAPID keys are missing in Vercel.");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:team@spans.co.in", pub, priv);
}

/** Send one message to every phone of these employees. Dead subscriptions (phone uninstalled / turned off) are removed. */
export async function sendToEmployees(employeeIds: string[], msg: PushMessage): Promise<SendResult> {
  setup();
  const db = adminDb();
  const ids = [...new Set(employeeIds)];
  const res: SendResult = { people: ids.length, phones: 0, sent: 0, failed: 0, noPhone: [] };
  if (!ids.length) return res;
  const [{ data: subs, error }, { data: emps }] = await Promise.all([
    db.from("push_subscriptions").select("id, employee_id, endpoint, p256dh, auth").in("employee_id", ids).like("endpoint", "https://%"),
    db.from("employees").select("id, name").in("id", ids),
  ]);
  if (error) throw new OpError(error.message);
  const withPhone = new Set((subs || []).map((s) => s.employee_id));
  res.noPhone = (emps || []).filter((e) => !withPhone.has(e.id)).map((e) => e.name);
  res.phones = subs?.length || 0;
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url || "/my", tag: msg.tag || "spans" });
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 4 * 3600, urgency: "high" });
      res.sent++;
      await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), last_error: null }).eq("id", s.id);
    } catch (e) {
      res.failed++;
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else await db.from("push_subscriptions").update({ last_error: `${code || ""} ${(e as Error).message}`.slice(0, 200) }).eq("id", s.id);
    }
  }));
  return res;
}

const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
export const todayISTDate = () => istNow().toISOString().slice(0, 10);

/**
 * Active employees with app access who haven't started work today: no check-in today, no shift still open from the
 * last 18 hours (night shift), no HR mark today and not their marked weekly off. On a Sunday, only people who marked
 * another day of that week as their weekly off (Sunday is otherwise the weekly off).
 */
export async function notCheckedInToday(): Promise<{ id: string; name: string }[]> {
  const db = adminDb();
  const today = todayISTDate();
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  const monday = new Date(Date.parse(today + "T00:00:00Z") - ((dow + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const since = new Date(Date.now() - 18 * 3600e3).toISOString();
  const [{ data: emps }, { data: todays }, { data: open }, { data: offs }] = await Promise.all([
    db.from("employees").select("id, name").eq("status", "Active").eq("app_access", true),
    db.from("attendance").select("employee_id, in_at, hr_status, self_status").eq("day", today),
    db.from("attendance").select("employee_id").is("out_at", null).gt("in_at", since),
    db.from("attendance").select("employee_id, day").eq("self_status", "week_off").gte("day", monday).lte("day", addDays(monday, 6)),
  ]);
  const busy = new Set<string>();
  for (const r of todays || []) if (r.in_at || r.hr_status || r.self_status === "week_off") busy.add(r.employee_id);
  for (const r of open || []) busy.add(r.employee_id);
  const markedThisWeek = new Set((offs || []).filter((r) => r.day !== today).map((r) => r.employee_id));
  return (emps || []).filter((e) => !busy.has(e.id) && (dow !== 0 || markedThisWeek.has(e.id)));
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/** Shifts checked in 10–18 hours ago, still open, not yet reminded. */
export async function shiftsToRemindCheckout() {
  const db = adminDb();
  const now = Date.now();
  const { data, error } = await db.from("attendance").select("id, employee_id, in_at")
    .is("out_at", null).is("checkout_reminded_at", null)
    .lt("in_at", new Date(now - 10 * 3600e3).toISOString()).gt("in_at", new Date(now - 18 * 3600e3).toISOString());
  if (error) throw new OpError(error.message);
  return data || [];
}

export async function markCheckoutReminded(ids: string[]) {
  if (ids.length) await adminDb().from("attendance").update({ checkout_reminded_at: new Date().toISOString() }).in("id", ids);
}

export const timeOfIST = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toUpperCase();
