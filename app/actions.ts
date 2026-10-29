"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import type { FormulaRow } from "@/lib/payroll";
import type { LineInputs } from "@/lib/run-logic";
import * as ops from "@/lib/ops";
import { OpError, type Ctx } from "@/lib/ops";

/** Send the user back to the page they came from with a readable error (production hides thrown messages). */
function fail(msg: string): never {
  const ref = headers().get("referer");
  let path = "/";
  if (ref) {
    const u = new URL(ref);
    u.searchParams.delete("saved"); u.searchParams.set("error", msg);
    path = u.pathname + u.search;
  }
  redirect(path);
}

async function db() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) fail("Not signed in");
  const { data } = await sb.from("app_users").select("email").limit(1);
  if (!data?.length) fail("Your login is not on the allowed list.");
  return { sb, user };
}

async function ctx(): Promise<Ctx> {
  const { sb, user } = await db();
  return { sb, email: user.email ?? "" };
}

/** Runs a shared operation; its user-facing errors go back to the page. */
async function attempt<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { if (e instanceof OpError) fail(e.message); throw e; }
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};
const numv = (f: FormData, k: string) => Number(f.get(k) || 0) || 0;
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

export async function formulasFor(month: string): Promise<{ id: string | null; formulas: FormulaRow[] }> {
  return ops.formulasFor(await ctx(), month);
}

// ───────────── Employees ─────────────
export async function saveEmployee(form: FormData) {
  const c = await ctx();
  const id = str(form, "id");
  const fields: Record<string, unknown> = {};
  // Only fields present in the form are written (masked Aadhaar/PAN/bank fields are omitted unless revealed)
  for (const k of ops.EMP_FIELDS) if (form.has(k)) fields[k] = str(form, k);
  fields.status = fields.status || "Active";
  fields.include_in_bank_file = bool(form, "include_in_bank_file");
  fields.sort_order = numv(form, "sort_order") || 100;
  const savedId = await attempt(ops.saveEmployee(c, id, fields));
  revalidatePath("/employees");
  redirect(`/employees/${savedId}?saved=1`);
}

export async function saveStructure(form: FormData) {
  const c = await ctx();
  const employee_id = String(form.get("employee_id"));
  const extras: Record<string, number> = {};
  for (const line of (str(form, "extras") || "").split(/\n|,/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*[:=]\s*(-?[\d.]+)\s*$/);
    if (m) extras[m[1]] = Number(m[2]);
    else if (line.trim()) fail(`Custom field "${line.trim()}" should look like name = 1000`);
  }
  const input: ops.StructureInput = { employee_id, effective_from: String(form.get("effective_from") || ""), extras, remarks: str(form, "remarks") };
  for (const k of ops.COMPONENT_KEYS) input[k] = numv(form, k);
  for (const k of ops.FLAG_KEYS) input[k] = bool(form, k);
  const savedId = await attempt(ops.saveStructure(c, input));
  revalidatePath(`/employees/${employee_id}`);
  // Show the calculation for the revision just saved
  redirect(`/employees/${employee_id}?tab=salary&saved=1&preview=${savedId}#preview`);
}

/** Returns one sensitive field in full and records who looked at it. */
export async function revealSensitive(employeeId: string, field: "aadhaar" | "pan" | "bank_account"): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await ops.revealSensitive(await ctx(), employeeId, field) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteEmployee(form: FormData) {
  await attempt(ops.deleteEmployee(await ctx(), String(form.get("id"))));
  revalidatePath("/employees");
  redirect("/employees?status=All&deleted=1");
}

export async function deleteStructure(form: FormData) {
  const employee_id = String(form.get("employee_id"));
  await attempt(ops.deleteStructure(await ctx(), String(form.get("id"))));
  revalidatePath(`/employees/${employee_id}`);
  redirect(`/employees/${employee_id}?tab=salary`);
}

// ───────────── Payroll months ─────────────
export async function createRun(form: FormData) {
  const run = await attempt(ops.createRun(await ctx(), String(form.get("month") || ""), str(form, "payment_date")));
  revalidatePath("/payroll");
  redirect(`/payroll/${run.id}`);
}

export async function saveLine(lineId: string, inputs: LineInputs & { remarks?: string | null }) {
  try {
    const line = await ops.saveLine(await ctx(), lineId, inputs);
    revalidatePath(`/payroll/${line.run_id}`);
    return { line };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function refreshRun(form: FormData) {
  const runId = String(form.get("run_id"));
  await attempt(ops.refreshRun(await ctx(), runId, {
    useLatestFormulas: bool(form, "use_latest_formulas"),
    refreshStructures: bool(form, "refresh_structures"),
    refreshDetails: bool(form, "refresh_details"),
  }));
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}?refreshed=1`);
}

export async function pullOtIncentives(form: FormData) {
  const runId = String(form.get("run_id"));
  await attempt(ops.pullOtIncentives(await ctx(), runId));
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function addEmployeeToRun(form: FormData) {
  const runId = String(form.get("run_id"));
  await attempt(ops.addEmployeeToRun(await ctx(), runId, String(form.get("employee_id"))));
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function removeLine(form: FormData) {
  const runId = await attempt(ops.removeLine(await ctx(), String(form.get("line_id"))));
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function updateRunMeta(form: FormData) {
  const runId = String(form.get("run_id"));
  await attempt(ops.updateRunMeta(await ctx(), runId, { payment_date: str(form, "payment_date"), notes: str(form, "notes") }));
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function finalizeRun(form: FormData) {
  const runId = String(form.get("run_id"));
  await attempt(ops.finalizeRun(await ctx(), runId));
  revalidatePath(`/payroll/${runId}`); revalidatePath("/payroll");
  redirect(`/payroll/${runId}`);
}

export async function reopenRun(form: FormData) {
  const runId = String(form.get("run_id"));
  await attempt(ops.reopenRun(await ctx(), runId));
  revalidatePath(`/payroll/${runId}`); revalidatePath("/payroll");
  redirect(`/payroll/${runId}`);
}

export async function deleteRun(form: FormData) {
  await attempt(ops.deleteRun(await ctx(), String(form.get("run_id"))));
  revalidatePath("/payroll");
  redirect("/payroll");
}

// ───────────── OT incentives & bonus ─────────────
export async function saveOt(form: FormData) {
  const ym = String(form.get("month") || "");
  const amount = str(form, "amount");
  await attempt(ops.addOt(await ctx(), {
    month: ym, employee_id: String(form.get("employee_id")), site: str(form, "site"),
    days: numv(form, "days"), amount: amount == null ? null : Number(amount), remarks: str(form, "remarks"),
  }));
  revalidatePath("/incentives");
  redirect(`/incentives?month=${ym}`);
}

export async function deleteOt(form: FormData) {
  await attempt(ops.deleteOt(await ctx(), String(form.get("id"))));
  revalidatePath("/incentives");
  redirect(`/incentives?month=${form.get("month") || ""}`);
}

export async function saveBonus(form: FormData) {
  await attempt(ops.addBonus(await ctx(), {
    fy: String(form.get("fy")), period: String(form.get("period")), employee_id: String(form.get("employee_id")),
    amount: numv(form, "amount"), transferred_on: str(form, "transferred_on"), remarks: str(form, "remarks"),
  }));
  revalidatePath("/bonus");
  redirect("/bonus");
}

export async function deleteBonus(form: FormData) {
  await attempt(ops.deleteBonus(await ctx(), String(form.get("id"))));
  revalidatePath("/bonus");
  redirect("/bonus");
}

// ───────────── Settings ─────────────
export async function saveCompany(form: FormData) {
  const fy_ids: Record<string, string> = {};
  for (const line of (str(form, "fy_ids") || "").split("\n")) {
    const m = line.match(/^\s*(FY\d{4}-\d{2})\s*[:=]\s*(\S+)\s*$/);
    if (m) fy_ids[m[1]] = m[2];
  }
  const orgzit = {
    created_by: str(form, "created_by") || "", created_by_id: str(form, "created_by_id") || "",
    type_of_transaction: str(form, "type_of_transaction") || "", expense_by: str(form, "expense_by") || "",
    expense_by_id: str(form, "expense_by_id") || "", type_of_expense: str(form, "type_of_expense") || "",
    gst_input: str(form, "gst_input") || "", status: str(form, "orgzit_status") || "", fy_ids,
  };
  await attempt(ops.saveCompany(await ctx(), {
    name: str(form, "name") || "Spans Envirotech Pvt. Ltd.", address: str(form, "address"), pan: str(form, "pan"),
    cin: str(form, "cin"), slip_notes: str(form, "slip_notes"), orgzit,
  }));
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function addAppUser(form: FormData) {
  await attempt(ops.addAppUser(await ctx(), str(form, "email") || "", str(form, "name")));
  revalidatePath("/settings");
  redirect("/settings");
}

export async function removeAppUser(form: FormData) {
  await attempt(ops.removeAppUser(await ctx(), String(form.get("email"))));
  revalidatePath("/settings");
  redirect("/settings");
}

export async function saveFormulaSet(input: { id?: string | null; effective_from: string; name: string; notes?: string; formulas: FormulaRow[] }) {
  try {
    const id = await ops.saveFormulaSet(await ctx(), input);
    revalidatePath("/settings/formulas");
    return { ok: true as const, id };
  } catch (e) {
    return { ok: false as const, errors: (e as Error).message.split("\n") };
  }
}

export async function deleteFormulaSet(form: FormData) {
  await attempt(ops.deleteFormulaSet(await ctx(), String(form.get("id"))));
  revalidatePath("/settings/formulas");
  redirect("/settings/formulas");
}

/** Revokes a connected app's (e.g. Claude's) access to your login. */
export async function revokeConnectedApp(form: FormData) {
  const sb = supabaseServer();
  const { error } = await sb.auth.oauth.revokeGrant({ clientId: String(form.get("client_id")) });
  if (error) fail(error.message);
  revalidatePath("/settings");
  redirect("/settings?saved=1#connected-apps");
}

export async function signOut() {
  const sb = supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}

// ───────────── Employee app access (mobile + PIN) ─────────────
/** Creates or updates the employee's login and sets a new PIN (random if none given). The PIN is returned once. */
export async function setEmployeePin(employeeId: string, pinInput?: string): Promise<{ ok: true; pin: string; mobile: string } | { ok: false; error: string }> {
  const { adminDb, checkPin, mobile10, newPin, pinPassword, staffEmail } = await import("@/lib/employee-auth");
  try {
    const { sb } = await ctx();
    const { data: e } = await sb.from("employees").select("id, name, mobile, status, auth_user_id").eq("id", employeeId).single();
    if (!e) return { ok: false, error: "Employee not found" };
    if (e.status === "Draft") return { ok: false, error: "Draft candidates don't get app access. Make them Active first." };
    const m = mobile10(e.mobile);
    if (!m) return { ok: false, error: "Add a 10-digit mobile number to this employee first; it's their login." };
    const { data: others } = await sb.from("employees").select("mobile").neq("id", e.id).not("auth_user_id", "is", null);
    if ((others || []).some((o) => mobile10(o.mobile) === m)) return { ok: false, error: "Another employee with app access has the same mobile number." };
    const pin = pinInput?.trim() || newPin();
    checkPin(pin);
    const admin = adminDb();
    const attrs = { email: staffEmail(m), password: pinPassword(m, pin), email_confirm: true,
      app_metadata: { kind: "employee", employee_id: e.id }, user_metadata: { name: e.name }, ban_duration: "none" };
    let userId = e.auth_user_id as string | null;
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, attrs);
      if (error) return { ok: false, error: error.message };
    } else {
      const { data, error } = await admin.auth.admin.createUser(attrs);
      if (error || !data.user) return { ok: false, error: error?.message.includes("already") ? "A login for this mobile number already exists. Contact support to link it." : error?.message || "Couldn't create the login" };
      userId = data.user.id;
    }
    const { error: e2 } = await sb.from("employees").update({ auth_user_id: userId, app_access: true }).eq("id", e.id);
    if (e2) return { ok: false, error: e2.message };
    revalidatePath(`/employees/${e.id}`);
    return { ok: true, pin, mobile: m };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Turns off the employee's app access and signs them out everywhere. */
export async function disableEmployeeApp(form: FormData) {
  const { adminDb } = await import("@/lib/employee-auth");
  const { sb } = await ctx();
  const id = String(form.get("id"));
  const { data: e } = await sb.from("employees").select("auth_user_id").eq("id", id).single();
  const { error } = await sb.from("employees").update({ app_access: false }).eq("id", id);
  if (error) fail(error.message);
  if (e?.auth_user_id) {
    try { await adminDb().auth.admin.updateUserById(e.auth_user_id, { ban_duration: "876000h" }); } catch { /* access is already off in the database */ }
  }
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}?saved=1#app-access`);
}

// ───────────── Attendance: sites, HR marks, payroll days ─────────────
/** Adds a site from a Google Maps link (short links too) or "lat, lng". */
export async function saveSite(form: FormData) {
  const { parseLatLng } = await import("@/lib/geo");
  const { sb } = await ctx();
  const name = str(form, "name");
  let where = str(form, "where") || "";
  if (!name) fail("Give the site a name");
  // Short links (maps.app.goo.gl / goo.gl/maps) redirect to the full link with the coordinates
  const isShort = (u: string) => { try { const h = new URL(u).hostname; return h === "maps.app.goo.gl" || h === "goo.gl"; } catch { return false; } };
  if (isShort(where)) {
    try {
      for (let i = 0; i < 4 && isShort(where); i++) {
        const r = await fetch(where, { redirect: "manual" });
        const loc = r.headers.get("location");
        if (!loc) break;
        where = loc;
      }
    } catch { /* fall through to the parse error */ }
  }
  const p = parseLatLng(where);
  if (!p) fail("Couldn't read a location. Paste a Google Maps link to the site, or the coordinates like 28.8955, 76.6066.");
  const radius = Math.round(numv(form, "radius_m") || 300);
  const { error } = await sb.from("sites").insert({ name, lat: p!.lat, lng: p!.lng, radius_m: radius });
  if (error) fail(error.message);
  revalidatePath("/attendance/sites");
  redirect("/attendance/sites?saved=1");
}

export async function updateSite(form: FormData) {
  const { sb } = await ctx();
  const id = String(form.get("id"));
  const row: Record<string, unknown> = {};
  if (form.has("radius_m")) row.radius_m = Math.round(numv(form, "radius_m"));
  if (form.has("active")) row.active = form.get("active") === "true";
  if (form.has("name")) row.name = str(form, "name");
  const { error } = await sb.from("sites").update(row).eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/attendance/sites");
  redirect("/attendance/sites?saved=1");
}

/** HR marks (or clears) a day for an employee; a reason is required. */
export async function markAttendance(form: FormData) {
  const { sb } = await ctx();
  const employee_id = String(form.get("employee_id")), day = String(form.get("day"));
  const status = str(form, "hr_status"), note = str(form, "hr_note");
  const back = `/attendance?m=${day.slice(0, 7)}&e=${employee_id}&d=${day}`;
  if (status && !note) fail("Add a reason for the mark (e.g. \"Phone not working, site in-charge confirmed\").");
  const { data: row } = await sb.from("attendance").select("id, in_at").eq("employee_id", employee_id).eq("day", day).maybeSingle();
  let error;
  if (row) ({ error } = await sb.from("attendance").update({ hr_status: status, hr_note: status ? note : null, updated_at: new Date().toISOString() }).eq("id", row.id));
  else if (status) ({ error } = await sb.from("attendance").insert({ employee_id, day, hr_status: status, hr_note: note }));
  if (error) fail(error.message);
  revalidatePath("/attendance");
  redirect(`${back}&saved=1`);
}

/** Applies suggested days from attendance to the chosen employees in a draft month. */
export async function applyAttendanceDays(form: FormData) {
  const { suggestDays } = await import("@/lib/attendance");
  const c = await ctx();
  const runId = String(form.get("run_id"));
  const chosen = form.getAll("line_id").map(String);
  if (!chosen.length) fail("Tick at least one employee.");
  const run = await attempt(ops.loadRun(c, runId));
  if (run.status === "finalized") fail("Reopen the month first.");
  const { data: lines } = await c.sb.from("payroll_lines").select("id, employee_id, snapshot, remarks").in("id", chosen);
  const ym = run.month.slice(0, 7);
  const { data: rows } = await c.sb.from("attendance").select("employee_id, day, in_at, in_on_site, hr_status")
    .gte("day", `${ym}-01`).lte("day", `${ym}-31`);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  for (const l of lines || []) {
    const s = suggestDays(l.snapshot, run.month, (rows || []).filter((r) => r.employee_id === l.employee_id && String(r.day).startsWith(ym)), today);
    await attempt(ops.saveLine(c, l.id, { working_days: s.working_days, paid_offs: s.paid_offs, leaves: s.leaves, lop_days: s.lop_days }));
  }
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}?saved=1`);
}
