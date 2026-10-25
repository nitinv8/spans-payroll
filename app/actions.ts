"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { DEFAULT_FORMULAS, monthEnd, validateFormulas, type FormulaRow } from "@/lib/payroll";
import {
  computeLine, defaultDays, eligibleForMonth, snapshotOf, sortEmployees, structureForMonth, structureValues,
  type Employee, type LineInputs, type Structure,
} from "@/lib/run-logic";

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

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return v == null || String(v).trim() === "" ? null : String(v).trim();
};
const numv = (f: FormData, k: string) => Number(f.get(k) || 0) || 0;
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

export async function formulasFor(month: string): Promise<{ id: string | null; formulas: FormulaRow[] }> {
  const { sb } = await db();
  const { data } = await sb.from("formula_sets").select("id, formulas").lte("effective_from", monthEnd(month))
    .order("effective_from", { ascending: false }).limit(1);
  if (data?.[0]) return { id: data[0].id, formulas: data[0].formulas as FormulaRow[] };
  return { id: null, formulas: DEFAULT_FORMULAS };
}

// ───────────── Employees ─────────────
const EMP_FIELDS = [
  "emp_code", "name", "father_name", "designation", "location", "status", "dob", "date_of_joining", "date_of_leaving", "mobile",
  "email", "bank_advice_email", "bank_account", "ifsc", "bank_name", "aadhaar", "pan", "uan", "esic_number", "blood_group",
  "tshirt_size", "shoe_size", "tshirt_status", "id_card", "epf_kyc", "orgzit_description", "orgzit_id", "notes", "joining_letter_url",
];

export async function saveEmployee(form: FormData) {
  const { sb } = await db();
  const id = str(form, "id");
  const row: Record<string, unknown> = {};
  for (const k of EMP_FIELDS) row[k] = str(form, k);
  row.status = row.status || "Active";
  row.include_in_bank_file = bool(form, "include_in_bank_file");
  row.sort_order = numv(form, "sort_order") || 100;
  if (row.ifsc) row.ifsc = String(row.ifsc).toUpperCase().replace(/\s/g, "");
  if (row.bank_account) row.bank_account = String(row.bank_account).replace(/\s/g, "");
  if (!row.emp_code || !row.name) fail("Employee # and name are required");
  if (row.date_of_leaving && row.status === "Active") row.status = "Inactive";
  if (row.joining_letter_url && !/^https?:\/\//i.test(String(row.joining_letter_url))) fail("Joining letter link should start with https://");
  const res = id ? await sb.from("employees").update(row).eq("id", id).select("id").single()
    : await sb.from("employees").insert(row).select("id").single();
  if (res.error) fail(res.error.message);
  revalidatePath("/employees");
  redirect(`/employees/${res.data.id}?saved=1`);
}

export async function saveStructure(form: FormData) {
  const { sb } = await db();
  const employee_id = String(form.get("employee_id"));
  const extras: Record<string, number> = {};
  const extraText = str(form, "extras") || "";
  for (const line of extraText.split(/\n|,/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*[:=]\s*(-?[\d.]+)\s*$/);
    if (m) extras[m[1]] = Number(m[2]);
    else if (line.trim()) fail(`Custom field "${line.trim()}" should look like name = 1000`);
  }
  const row = {
    employee_id, effective_from: String(form.get("effective_from")),
    basic: numv(form, "basic"), hra: numv(form, "hra"), medical: numv(form, "medical"), conveyance: numv(form, "conveyance"),
    mobile: numv(form, "mobile"), site_allowance: numv(form, "site_allowance"), supervisor_allowance: numv(form, "supervisor_allowance"),
    overtime: numv(form, "overtime"), esi_applicable: bool(form, "esi_applicable"), pf_applicable: bool(form, "pf_applicable"),
    lwf_applicable: bool(form, "lwf_applicable"), bonus_applicable: bool(form, "bonus_applicable"),
    gratuity_applicable: bool(form, "gratuity_applicable"), pt_applicable: bool(form, "pt_applicable"),
    extras, remarks: str(form, "remarks"),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.effective_from)) fail("Effective from date is required");
  const { error } = await sb.from("salary_structures").upsert(row, { onConflict: "employee_id,effective_from" });
  if (error) fail(error.message);
  revalidatePath(`/employees/${employee_id}`);
  redirect(`/employees/${employee_id}?tab=salary&saved=1`);
}

/** Deletes an employee only if they have never appeared on a payroll (history must be kept). */
export async function deleteEmployee(form: FormData) {
  const { sb } = await db();
  const id = String(form.get("id"));
  const { count } = await sb.from("payroll_lines").select("id", { count: "exact", head: true }).eq("employee_id", id);
  if (count) fail(`This employee is on ${count} payroll month(s), so they can't be deleted. Set their status to Inactive and add a last working date instead.`);
  const { error } = await sb.from("employees").delete().eq("id", id);
  if (error) fail(error.message.includes("foreign key") ? "This employee has payroll history, so they can't be deleted. Mark them Inactive instead." : error.message);
  revalidatePath("/employees");
  redirect("/employees?status=All&deleted=1");
}

export async function deleteStructure(form: FormData) {
  const { sb } = await db();
  const id = String(form.get("id")), employee_id = String(form.get("employee_id"));
  const { error } = await sb.from("salary_structures").delete().eq("id", id);
  if (error) fail(error.message);
  revalidatePath(`/employees/${employee_id}`);
  redirect(`/employees/${employee_id}?tab=salary`);
}

// ───────────── Payroll runs ─────────────
async function otTotals(sb: ReturnType<typeof supabaseServer>, month: string) {
  const { data } = await sb.from("ot_incentives").select("employee_id, amount").eq("month", month);
  const m: Record<string, number> = {};
  for (const r of data || []) m[r.employee_id] = (m[r.employee_id] || 0) + (Number(r.amount) || 0);
  return m;
}

export async function createRun(form: FormData) {
  const { sb } = await db();
  const ym = String(form.get("month") || "");
  if (!/^\d{4}-\d{2}$/.test(ym)) fail("Pick a month");
  const month = `${ym}-01`;
  const payment_date = str(form, "payment_date");
  const { id: formula_set_id, formulas } = await formulasFor(month);

  const { data: emps, error: e1 } = await sb.from("employees").select("*");
  if (e1) fail(e1.message);
  const { data: structs } = await sb.from("salary_structures").select("*");
  const ot = await otTotals(sb, month);
  const eligible = sortEmployees((emps as Employee[]).filter((e) => eligibleForMonth(e, month)));

  const { data: run, error: e2 } = await sb.from("payroll_runs")
    .insert({ month, payment_date, formula_set_id, formulas, status: "draft" }).select("id").single();
  if (e2) fail(e2.message.includes("duplicate") ? "A payroll for this month already exists." : e2.message);

  const lines = eligible.map((e, i) => {
    const s = structureForMonth((structs as Structure[]).filter((x) => x.employee_id === e.id), month);
    const snap = snapshotOf(e);
    const d = defaultDays(e, month);
    const inputs: LineInputs = {
      working_days: d.working_days, paid_offs: d.paid_offs, leaves: 0, lop_days: d.lop_days,
      incentive: ot[e.id] || 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0,
    };
    const sv = s ? structureValues(s) : null;
    const r = computeLine(formulas, month, snap, sv, inputs);
    return {
      run_id: run.id, employee_id: e.id, print_code: `C${i + 1}`, snapshot: snap, structure_id: s?.id ?? null, structure: sv,
      ...inputs, ...r, remarks: d.lop_days ? "Joined/left mid-month: LOP days pre-filled" : null,
    };
  });
  if (lines.length) {
    const { error } = await sb.from("payroll_lines").insert(lines);
    if (error) fail(error.message);
  }
  revalidatePath("/payroll");
  redirect(`/payroll/${run.id}`);
}

async function loadRun(sb: ReturnType<typeof supabaseServer>, runId: string) {
  const { data: run, error } = await sb.from("payroll_runs").select("*").eq("id", runId).single();
  if (error || !run) fail("Payroll month not found");
  return run as { id: string; month: string; status: string; formulas: FormulaRow[] };
}

export async function saveLine(lineId: string, inputs: LineInputs & { remarks?: string | null }) {
  let sb;
  try { ({ sb } = await db()); } catch (e) { return { error: (e as Error).message }; }
  const { data: line, error } = await sb.from("payroll_lines").select("*").eq("id", lineId).single();
  if (error || !line) return { error: "Line not found" };
  let run;
  try { run = await loadRun(sb, line.run_id); } catch (e) { return { error: (e as Error).message }; }
  if (run.status === "finalized") return { error: "This month is finalized. Reopen it to edit." };
  const num = (v: unknown, allowNegative = false) => { const x = Number(v) || 0; return allowNegative ? x : Math.max(0, x); };
  const clean: LineInputs = {
    working_days: num(inputs.working_days), paid_offs: num(inputs.paid_offs), leaves: num(inputs.leaves),
    lop_days: num(inputs.lop_days), incentive: num(inputs.incentive), arrears: num(inputs.arrears),
    ex_gratia: num(inputs.ex_gratia), manual_adjustment: num(inputs.manual_adjustment, true),
    professional_tax: num(inputs.professional_tax), advance_recovery: num(inputs.advance_recovery), other_deduction: num(inputs.other_deduction),
  };
  const r = computeLine(run.formulas, run.month, line.snapshot, line.structure, clean);
  const { data: saved, error: e2 } = await sb.from("payroll_lines")
    .update({ ...clean, ...r, remarks: inputs.remarks ?? line.remarks, updated_at: new Date().toISOString() })
    .eq("id", lineId).select("*").single();
  if (e2) return { error: e2.message };
  revalidatePath(`/payroll/${run.id}`);
  return { line: saved };
}

/** Re-pulls formulas, employee details and salary structures (keeps entered days/amounts), adds newly eligible staff. */
export async function refreshRun(form: FormData) {
  const { sb } = await db();
  const runId = String(form.get("run_id"));
  const run = await loadRun(sb, runId);
  if (run.status === "finalized") fail("Reopen the month first.");
  const { id: formula_set_id, formulas } = await formulasFor(run.month);
  await sb.from("payroll_runs").update({ formulas, formula_set_id }).eq("id", runId);
  const { data: emps } = await sb.from("employees").select("*");
  const { data: structs } = await sb.from("salary_structures").select("*");
  const { data: lines } = await sb.from("payroll_lines").select("*").eq("run_id", runId);
  const ot = await otTotals(sb, run.month);
  const byEmp = new Map((lines || []).map((l) => [l.employee_id, l]));
  const all = sortEmployees(emps as Employee[]);
  let code = (lines || []).length;
  for (const e of all) {
    const s = structureForMonth((structs as Structure[]).filter((x) => x.employee_id === e.id), run.month);
    const sv = s ? structureValues(s) : null;
    const snap = snapshotOf(e);
    const existing = byEmp.get(e.id);
    if (existing) {
      const inputs: LineInputs = existing;
      const r = computeLine(formulas, run.month, snap, sv, inputs);
      await sb.from("payroll_lines").update({ snapshot: snap, structure: sv, structure_id: s?.id ?? null, ...r }).eq("id", existing.id);
    } else if (eligibleForMonth(e, run.month)) {
      const d = defaultDays(e, run.month);
      const inputs: LineInputs = { working_days: d.working_days, paid_offs: d.paid_offs, leaves: 0, lop_days: d.lop_days,
        incentive: ot[e.id] || 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0 };
      const r = computeLine(formulas, run.month, snap, sv, inputs);
      await sb.from("payroll_lines").insert({ run_id: runId, employee_id: e.id, print_code: `C${++code}`, snapshot: snap,
        structure: sv, structure_id: s?.id ?? null, ...inputs, ...r });
    }
  }
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}?refreshed=1`);
}

export async function pullOtIncentives(form: FormData) {
  const { sb } = await db();
  const runId = String(form.get("run_id"));
  const run = await loadRun(sb, runId);
  if (run.status === "finalized") fail("Reopen the month first.");
  const ot = await otTotals(sb, run.month);
  const { data: lines } = await sb.from("payroll_lines").select("*").eq("run_id", runId);
  for (const l of lines || []) {
    const inc = ot[l.employee_id] || 0;
    if (Number(l.incentive) === inc) continue;
    const r = computeLine(run.formulas, run.month, l.snapshot, l.structure, { ...l, incentive: inc });
    await sb.from("payroll_lines").update({ incentive: inc, ...r }).eq("id", l.id);
  }
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function addEmployeeToRun(form: FormData) {
  const { sb } = await db();
  const runId = String(form.get("run_id")), employeeId = String(form.get("employee_id"));
  const run = await loadRun(sb, runId);
  const { data: e } = await sb.from("employees").select("*").eq("id", employeeId).single();
  if (e?.status === "Draft") fail("Draft employees can't be added to payroll. Change their status to Active first.");
  const { data: structs } = await sb.from("salary_structures").select("*").eq("employee_id", employeeId);
  const { count } = await sb.from("payroll_lines").select("id", { count: "exact", head: true }).eq("run_id", runId);
  const s = structureForMonth((structs || []) as Structure[], run.month);
  const sv = s ? structureValues(s) : null;
  const snap = snapshotOf(e as Employee);
  const d = defaultDays(e as Employee, run.month);
  const ot = await otTotals(sb, run.month);
  const inputs: LineInputs = { working_days: d.working_days, paid_offs: d.paid_offs, leaves: 0, lop_days: d.lop_days,
    incentive: ot[employeeId] || 0, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0 };
  const r = computeLine(run.formulas, run.month, snap, sv, inputs);
  const { error } = await sb.from("payroll_lines").insert({ run_id: runId, employee_id: employeeId, print_code: `C${(count || 0) + 1}`,
    snapshot: snap, structure: sv, structure_id: s?.id ?? null, ...inputs, ...r });
  if (error) fail(error.message);
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function removeLine(form: FormData) {
  const { sb } = await db();
  const id = String(form.get("line_id")), runId = String(form.get("run_id"));
  const { error } = await sb.from("payroll_lines").delete().eq("id", id);
  if (error) fail(error.message);
  // renumber print codes
  const { data: lines } = await sb.from("payroll_lines").select("id, print_code").eq("run_id", runId);
  const sorted = (lines || []).sort((a, b) => Number(a.print_code?.slice(1)) - Number(b.print_code?.slice(1)));
  for (let i = 0; i < sorted.length; i++) if (sorted[i].print_code !== `C${i + 1}`)
    await sb.from("payroll_lines").update({ print_code: `C${i + 1}` }).eq("id", sorted[i].id);
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function updateRunMeta(form: FormData) {
  const { sb } = await db();
  const runId = String(form.get("run_id"));
  const { error } = await sb.from("payroll_runs").update({ payment_date: str(form, "payment_date"), notes: str(form, "notes") }).eq("id", runId);
  if (error) fail(error.message);
  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
}

export async function finalizeRun(form: FormData) {
  const { sb, user } = await db();
  const runId = String(form.get("run_id"));
  const { data: bad } = await sb.from("payroll_lines").select("id").eq("run_id", runId).not("error", "is", null);
  if (bad?.length) fail("Fix the rows with errors before finalizing.");
  const { error } = await sb.from("payroll_runs").update({ status: "finalized", finalized_at: new Date().toISOString(), finalized_by: user.email }).eq("id", runId);
  if (error) fail(error.message);
  revalidatePath(`/payroll/${runId}`); revalidatePath("/payroll");
  redirect(`/payroll/${runId}`);
}

export async function reopenRun(form: FormData) {
  const { sb } = await db();
  const runId = String(form.get("run_id"));
  const { error } = await sb.from("payroll_runs").update({ status: "draft", finalized_at: null, finalized_by: null }).eq("id", runId);
  if (error) fail(error.message);
  revalidatePath(`/payroll/${runId}`); revalidatePath("/payroll");
  redirect(`/payroll/${runId}`);
}

export async function deleteRun(form: FormData) {
  const { sb } = await db();
  const runId = String(form.get("run_id"));
  const run = await loadRun(sb, runId);
  if (run.status === "finalized") fail("Reopen the month before deleting it.");
  const { error } = await sb.from("payroll_runs").delete().eq("id", runId);
  if (error) fail(error.message);
  revalidatePath("/payroll");
  redirect("/payroll");
}

// ───────────── OT incentives & bonus ─────────────
export async function saveOt(form: FormData) {
  const { sb } = await db();
  const ym = String(form.get("month") || "");
  const amount = str(form, "amount");
  const { error } = await sb.from("ot_incentives").insert({
    month: `${ym}-01`, employee_id: String(form.get("employee_id")), site: str(form, "site"),
    days: numv(form, "days"), amount: amount == null ? null : Number(amount), remarks: str(form, "remarks"),
  });
  if (error) fail(error.message);
  revalidatePath("/incentives");
  redirect(`/incentives?month=${ym}`);
}

export async function deleteOt(form: FormData) {
  const { sb } = await db();
  await sb.from("ot_incentives").delete().eq("id", String(form.get("id")));
  revalidatePath("/incentives");
  redirect(`/incentives?month=${form.get("month") || ""}`);
}

export async function saveBonus(form: FormData) {
  const { sb } = await db();
  const { error } = await sb.from("bonus_payments").insert({
    fy: String(form.get("fy")), period: String(form.get("period")), employee_id: String(form.get("employee_id")),
    amount: numv(form, "amount"), transferred_on: str(form, "transferred_on"), remarks: str(form, "remarks"),
  });
  if (error) fail(error.message);
  revalidatePath("/bonus");
  redirect("/bonus");
}

export async function deleteBonus(form: FormData) {
  const { sb } = await db();
  await sb.from("bonus_payments").delete().eq("id", String(form.get("id")));
  revalidatePath("/bonus");
  redirect("/bonus");
}

// ───────────── Settings ─────────────
export async function saveCompany(form: FormData) {
  const { sb } = await db();
  let fy_ids: Record<string, string> = {};
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
  const { error } = await sb.from("company_settings").update({
    name: str(form, "name") || "Spans Envirotech Pvt. Ltd.", address: str(form, "address"), pan: str(form, "pan"),
    cin: str(form, "cin"), slip_notes: str(form, "slip_notes"), orgzit, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) fail(error.message);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function addAppUser(form: FormData) {
  const { sb } = await db();
  const email = (str(form, "email") || "").toLowerCase();
  if (!email.includes("@")) fail("Enter an email");
  const { error } = await sb.from("app_users").insert({ email, name: str(form, "name") });
  if (error) fail(error.message);
  revalidatePath("/settings");
  redirect("/settings");
}

export async function removeAppUser(form: FormData) {
  const { sb, user } = await db();
  const email = String(form.get("email"));
  if (email.toLowerCase() === user.email?.toLowerCase()) fail("You can't remove yourself.");
  await sb.from("app_users").delete().eq("email", email);
  revalidatePath("/settings");
  redirect("/settings");
}

export async function saveFormulaSet(input: { id?: string | null; effective_from: string; name: string; notes?: string; formulas: FormulaRow[] }) {
  const { sb } = await db();
  const errs = validateFormulas(input.formulas);
  if (errs.length) return { ok: false as const, errors: errs };
  if (!/^\d{4}-\d{2}-01$/.test(input.effective_from)) return { ok: false as const, errors: ["Effective from must be the 1st of a month"] };
  const row = { effective_from: input.effective_from, name: input.name || "Formula set", notes: input.notes || null, formulas: input.formulas };
  const res = input.id ? await sb.from("formula_sets").update(row).eq("id", input.id).select("id").single()
    : await sb.from("formula_sets").insert(row).select("id").single();
  if (res.error) return { ok: false as const, errors: [res.error.message.includes("duplicate") ? "A formula set already starts on that month – edit that one instead." : res.error.message] };
  revalidatePath("/settings/formulas");
  return { ok: true as const, id: res.data.id as string };
}

export async function deleteFormulaSet(form: FormData) {
  const { sb } = await db();
  await sb.from("formula_sets").delete().eq("id", String(form.get("id")));
  revalidatePath("/settings/formulas");
  redirect("/settings/formulas");
}

export async function signOut() {
  const sb = supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
