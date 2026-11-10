// Scheduled reminders, called by the database scheduler (pg_cron + pg_net) with the CRON_SECRET.
//   POST /api/cron/reminders?kind=checkin   → 10 AM IST: everyone who hasn't started work today
//   POST /api/cron/reminders?kind=checkout  → every 15 min: shifts open 10+ hours, once per shift
import { timingSafeEqual } from "node:crypto";
import { markCheckoutReminded, notCheckedInToday, sendToEmployees, shiftsToRemindCheckout, timeOfIST } from "@/lib/push";

export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const want = process.env.CRON_SECRET || "";
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return want.length >= 32 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const kind = new URL(req.url).searchParams.get("kind");
  try {
    if (kind === "checkin") {
      const people = await notCheckedInToday();
      const r = await sendToEmployees(people.map((p) => p.id), {
        title: "Mark your attendance", body: "You haven't checked in today. Open Spans Payroll and tap Check in.", tag: "checkin",
      });
      return Response.json({ kind, people: r.people, sent: r.sent, failed: r.failed });
    }
    if (kind === "checkout") {
      const shifts = await shiftsToRemindCheckout();
      let sent = 0;
      for (const s of shifts) {
        const r = await sendToEmployees([s.employee_id], {
          title: "Still checked in", body: `You checked in at ${timeOfIST(s.in_at)}. Remember to check out when your shift ends.`, tag: "checkout",
        });
        sent += r.sent;
      }
      await markCheckoutReminded(shifts.map((s) => s.id));
      return Response.json({ kind, shifts: shifts.length, sent });
    }
    return Response.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
