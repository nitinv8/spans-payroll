// Payroll operations shared by the web app (server actions) and the MCP endpoint, so both follow the same rules.
// Every function takes a Supabase client that is already signed in as the user: access rules (RLS),
// finalized-month locks and the audit trail are enforced by the database for both.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_FORMULAS, monthEnd, validateFormulas, type FormulaRow } from "./payroll";
import {
  computeLine, defaultDays, eligibleForMonth, snapshotOf, sortEmployees, structureForMonth, structureValues,
  type Employee, type LineInputs, type Structure,
} from "./run-logic";

/** An error meant for the person using the app (shown as-is). */
export class OpError extends Error {}
const fail = (msg: string): never => { throw new OpError(msg); };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ctx = { sb: SupabaseClient<any, any, any>; email: string };
export type Run = { id: string; month: string; status: string; formulas: FormulaRow[]; payment_date: string | null; notes: string | null };

export const isMonth = (m: string) => /^\d{4}-\d{2}(-01)?$/.test(m);
export const monthStart = (m: string) => (m.length === 7 ? `${m}-01` : m);

// ───────────── Formulas ─────────────
export async function formulasFor({ sb }: Ctx, month: string): Promise<{ id: string | null; formulas: FormulaRow[] }> {
  const { data } = await sb.from("formula_sets").select("id, formulas").lte("effective_from", monthEnd(month))
    .order("effective_from", { ascending: false }).limit(1);
  if (data?.[0]) return { id: data[0].id, formulas: data[0].formulas as FormulaRow[] };
  return { id: null, formulas: DEFAULT_FORMULAS };
}

export async function saveFormulaSet({ sb }: Ctx, input: { id?: string | null; effective_from: string; name: string; notes?: string | null; formulas: FormulaRow[] }) {
  const errs = validateFormulas(input.formulas);
  if (errs.length) fail(errs.join("\n"));
  if (!/^\d{4}-\d{2}-01$/.test(input.effective_from)) fail("Effective from must be the 1st of a month");
  const row = { effective_from: input.effective_from, name: input.name || "Formula set", notes: input.notes || null, formulas: input.formulas };
  const res = input.id ? await sb.from("formula_sets").update(row).eq("id", input.id).select("id").single()
    : await sb.from("formula_sets").insert(row).select("id").single();
  if (res.error) fail(res.error.message.includes("duplicate") ? "A formula set already starts on that month – edit that one instead." : res.error.message);
  return res.data!.id as string;
}

export async function deleteFormulaSet({ sb }: Ctx, id: string) {
  const { error } = await sb.from("formula_sets").delete().eq("id", id);
  if (error) fail(error.message);
}

// ───────────── Employees ─────────────
export const EMP_FIELDS = [
  "emp_code", "name", "father_name", "designation", "location", "status", "dob", "date_of_joining", "date_of_leaving", "mobile",
  "email", "bank_advice_email", "bank_account", "ifsc", "bank_name", "aadhaar", "pan", "uan", "esic_number", "blood_group",
  "tshirt_size", "shoe_size", "tshirt_status", "id_card", "epf_kyc", "orgzit_description", "orgzit_id", "notes", "joining_letter_url", "state",
  "include_in_bank_file", "sort_order",
] as const;
export const STATUSES = ["Active", "Draft", "Inactive"];

/** Creates (no id) or updates an employee. Only the keys present in `fields` are written. */
export async function saveEmployee({ sb }: Ctx, id: string | null, fields: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const k of EMP_FIELDS) if (k in fields) {
    const v = fields[k];
    row[k] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null;
  }
  if (!id) {
    row.status = row.status || "Active";
    if (!("include_in_bank_file" in row)) row.include_in_bank_file = true;
    if (!("sort_order" in row)) row.sort_order = 100;
  }
  if (row.status && !STATUSES.includes(String(row.status))) fail(`Status must be one of ${STATUSES.join(", ")}`);
  if (row.ifsc) row.ifsc = String(row.ifsc).toUpperCase().replace(/\s/g, "");
  if (row.bank_account) row.bank_account = String(row.bank_account).replace(/\s/g, "");
  if ((!id || "emp_code" in row) && !row.emp_code) fail("Employee # is required");
  if ((!id || "name" in row) && !row.name) fail("Name is required");
  if (row.date_of_leaving && row.status === "Active") row.status = "Inactive";
  if (row.joining_letter_url && !/^https?:\/\//i.test(String(row.joining_letter_url))) fail("Joining letter link should start with https://");
  for (const d of ["dob", "date_of_joining", "date_of_leaving"]) if (row[d] && !/^\d{4}-\d{2}-\d{2}$/.test(String(row[d]))) fail(`${d} should be a date like 2026-10-01`);
  const res = id ? await sb.from("employees").update(row).eq("id", id).select("id").single()
    : await sb.from("employees").insert(row).select("id").single();
  if (res.error) fail(res.error.message.includes("duplicate") ? "That employee # is already used." : res.error.message);
  return res.data!.id as string;
}

export const SENSITIVE = ["aadhaar", "pan", "bank_account"] as const;
export type SensitiveField = (typeof SENSITIVE)[number];

/** Returns one sensitive field in full and records who looked at it. */
export async function revealSensitive({ sb }: Ctx, employeeId: string, field: SensitiveField) {
  if (!SENSITIVE.includes(field)) fail("Not allowed");
  const { data, error } = await sb.from("employees").select(`id, ${field}`).eq("id", employeeId).single();
  if (error || !data) fail("Employee not found");
  const { error: e2 } = await sb.from("audit_log").insert({ table_name: "employees", row_id: employeeId, action: "REVEAL", new: { field } });
  if (e2) fail(`Couldn't record the reveal in the audit log: ${e2.message}`);
  return ((data as unknown as Record<string, string | null>)[field] ?? "") as string;
}

/** Deletes an employee only if they have never appeared on a payroll (history must be kept). */
export async function deleteEmployee({ sb }: Ctx, id: string) {
  const { count } = await sb.from("payroll_lines").select("id", { count: "exact", head: true }).eq("employee_id", id);
  if (count) fail(`This employee is on ${count} payroll month(s), so they can't be deleted. Set their status to Inactive and add a last working date instead.`);
  const { error } = await sb.from("employees").delete().eq("id", id);
  if (error) fail(error.message.includes("foreign key") ? "This employee has payroll history, so they can't be deleted. Mark them Inactive instead." : error.message);
}

// ───────────── Salary structures ─────────────
export const COMPONENT_KEYS = ["basic", "hra", "medical", "conveyance", "mobile", "site_allowance", "supervisor_allowance", "overtime"] as const;
export const FLAG_KEYS = ["esi_applicable", "pf_applicable", "lwf_applicable", "bonus_applicable", "gratuity_applicable", "pt_applicable"] as const;

export type StructureInput = { employee_id: string; effective_from: string; remarks?: string | null; extras?: Record<string, number> }
  & Partial<Record<(typeof COMPONENT_KEYS)[number], number>> & Partial<Record<(typeof FLAG_KEYS)[number], boolean>>;

/** Saves a salary revision; an existing revision with the same date is overwritten. */
export async function saveStructure({ sb }: Ctx, input: StructureInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_from || "")) fail("Effective from date is required (YYYY-MM-DD)");
  const row: Record<string, unknown> = { employee_id: input.employee_id, effective_from: input.effective_from, remarks: input.remarks ?? null, extras: input.extras ?? {} };
  for (const k of COMPONENT_KEYS) {
    const v = Number(input[k] ?? 0);
    if (!Number.isFinite(v) || v < 0) fail(`${k} must be a positive amount`);
    row[k] = v;
  }
  for (const k of FLAG_KEYS) row[k] = !!input[k];
  for (const [k, v] of Object.entries(row.extras as Record<string, number>)) {
    if (!/^[A-Za-z_]\w*$/.test(k) || !Number.isFinite(Number(v))) fail(`Custom field "${k}" should be a name with a number`);
  }
  const { data, error } = await sb.from("salary_structures").upsert(row, { onConflict: "employee_id,effective_from" }).select("id").single();
  if (error) fail(error.message);
  return data!.id as string;
}

export async function deleteStructure({ sb }: Ctx, id: string) {
  const { error } = await sb.from("salary_structures").delete().eq("id", id);
  if (error) fail(error.message);
}

// ───────────── Payroll months ─────────────
async function otTotals({ sb }: Ctx, month: string) {
  const { data } = await sb.from("ot_incentives").select("employee_id, amount").eq("month", month);
  const m: Record<string, number> = {};
  for (const r of data || []) m[r.employee_id] = (m[r.employee_id] || 0) + (Number(r.amount) || 0);
  return m;
}

const blankInputs = (d: { working_days: number; paid_offs: number; lop_days: number }, incentive: number): LineInputs => ({
  working_days: d.working_days, paid_offs: d.paid_offs, leaves: 0, lop_days: d.lop_days,
  incentive, arrears: 0, ex_gratia: 0, manual_adjustment: 0, professional_tax: 0,
});

/** Starts a month: every eligible employee with days pre-filled (Sundays off, LOP for days not employed) and OT pulled in. */
export async function createRun(ctx: Ctx, month: string, payment_date: string | null) {
  const { sb } = ctx;
  if (!isMonth(month)) fail("Pick a month (YYYY-MM)");
  month = monthStart(month);
  const { id: formula_set_id, formulas } = await formulasFor(ctx, month);
  const [{ data: emps, error: e1 }, { data: structs }, ot] = await Promise.all([
    sb.from("employees").select("*"), sb.from("salary_structures").select("*"), otTotals(ctx, month),
  ]);
  if (e1) fail(e1.message);
  const eligible = sortEmployees((emps as Employee[]).filter((e) => eligibleForMonth(e, month)));
  const { data: run, error: e2 } = await sb.from("payroll_runs")
    .insert({ month, payment_date, formula_set_id, formulas, status: "draft" }).select("id").single();
  if (e2) fail(e2.message.includes("duplicate") ? "A payroll for this month already exists." : e2.message);
  const lines = eligible.map((e, i) => {
    const s = structureForMonth((structs as Structure[]).filter((x) => x.employee_id === e.id), month);
    const snap = snapshotOf(e);
    const d = defaultDays(e, month);
    const inputs = blankInputs(d, ot[e.id] || 0);
    const sv = s ? structureValues(s) : null;
    const r = computeLine(formulas, month, snap, sv, inputs);
    return {
      run_id: run!.id, employee_id: e.id, print_code: `C${i + 1}`, snapshot: snap, structure_id: s?.id ?? null, structure: sv,
      ...inputs, ...r, remarks: d.lop_days ? "Joined/left mid-month: LOP days pre-filled" : null,
    };
  });
  if (lines.length) {
    const { error } = await sb.from("payroll_lines").insert(lines);
    if (error) fail(error.message);
  }
  return { id: run!.id as string, employees: lines.length };
}

export async function loadRun({ sb }: Ctx, runId: string) {
  const { data: run, error } = await sb.from("payroll_runs").select("*").eq("id", runId).single();
  if (error || !run) fail("Payroll month not found");
  return run as Run;
}

const editable = (run: Run) => { if (run.status === "finalized") fail("This month is finalized. Reopen it first."); };

export type LineUpdate = Partial<LineInputs> & { remarks?: string | null };
export const LINE_INPUT_KEYS = ["working_days", "paid_offs", "leaves", "lop_days", "incentive", "arrears", "ex_gratia",
  "manual_adjustment", "professional_tax", "advance_recovery", "other_deduction"] as const;

/** Updates one employee's inputs for a month (missing keys keep their current value) and recalculates. */
export async function saveLine(ctx: Ctx, lineId: string, update: LineUpdate) {
  const { sb } = ctx;
  const { data: line, error } = await sb.from("payroll_lines").select("*").eq("id", lineId).single();
  if (error || !line) fail("Line not found");
  const run = await loadRun(ctx, line.run_id);
  editable(run);
  const num = (k: (typeof LINE_INPUT_KEYS)[number]) => {
    const x = Number(k in update ? update[k] : line[k]) || 0;
    return k === "manual_adjustment" ? x : Math.max(0, x);
  };
  const clean = Object.fromEntries(LINE_INPUT_KEYS.map((k) => [k, num(k)])) as unknown as LineInputs;
  const r = computeLine(run.formulas, run.month, line.snapshot, line.structure, clean);
  const { data: saved, error: e2 } = await sb.from("payroll_lines")
    .update({ ...clean, ...r, remarks: "remarks" in update ? update.remarks ?? null : line.remarks, updated_at: new Date().toISOString() })
    .eq("id", lineId).select("*").single();
  if (e2) fail(e2.message);
  return saved;
}

export type RefreshOptions = { useLatestFormulas?: boolean; refreshStructures?: boolean; refreshDetails?: boolean };

/**
 * Re-calculates a draft month. Days and amounts entered are always kept; newly eligible staff are added.
 *  - useLatestFormulas: switch to the formula version now in force (default: keep this month's stored formulas)
 *  - refreshStructures: use salary structures as they stand now for this month
 *  - refreshDetails:    copy current employee details (name, bank, UAN…) into this month
 */
export async function refreshRun(ctx: Ctx, runId: string, o: RefreshOptions) {
  const { sb } = ctx;
  const run = await loadRun(ctx, runId);
  editable(run);
  let formulas = run.formulas;
  if (o.useLatestFormulas) {
    const latest = await formulasFor(ctx, run.month);
    formulas = latest.formulas;
    const { error } = await sb.from("payroll_runs").update({ formulas, formula_set_id: latest.id }).eq("id", runId);
    if (error) fail(error.message);
  }
  const [{ data: emps }, { data: structs }, { data: lines }, ot] = await Promise.all([
    sb.from("employees").select("*"), sb.from("salary_structures").select("*"),
    sb.from("payroll_lines").select("*").eq("run_id", runId), otTotals(ctx, run.month),
  ]);
  const byEmp = new Map((lines || []).map((l) => [l.employee_id, l]));
  let code = (lines || []).length, updated = 0, added = 0;
  for (const e of sortEmployees(emps as Employee[])) {
    const s = structureForMonth((structs as Structure[]).filter((x) => x.employee_id === e.id), run.month);
    const existing = byEmp.get(e.id);
    if (existing) {
      const sv = o.refreshStructures ? (s ? structureValues(s) : null) : existing.structure;
      const snap = o.refreshDetails ? snapshotOf(e) : existing.snapshot;
      const r = computeLine(formulas, run.month, snap, sv, existing as LineInputs);
      const { error } = await sb.from("payroll_lines").update({
        snapshot: snap, structure: sv, ...(o.refreshStructures ? { structure_id: s?.id ?? null } : {}), ...r,
      }).eq("id", existing.id);
      if (error) fail(error.message);
      updated++;
    } else if (eligibleForMonth(e, run.month)) {
      const sv = s ? structureValues(s) : null;
      const inputs = blankInputs(defaultDays(e, run.month), ot[e.id] || 0);
      const r = computeLine(formulas, run.month, snapshotOf(e), sv, inputs);
      const { error } = await sb.from("payroll_lines").insert({ run_id: runId, employee_id: e.id, print_code: `C${++code}`, snapshot: snapshotOf(e),
        structure: sv, structure_id: s?.id ?? null, ...inputs, ...r });
      if (error) fail(error.message);
      added++;
    }
  }
  return { updated, added };
}

/** Sets each employee's Incentive to the month's OT incentive total. */
export async function pullOtIncentives(ctx: Ctx, runId: string) {
  const { sb } = ctx;
  const run = await loadRun(ctx, runId);
  editable(run);
  const ot = await otTotals(ctx, run.month);
  const { data: lines } = await sb.from("payroll_lines").select("*").eq("run_id", runId);
  let changed = 0;
  for (const l of lines || []) {
    const inc = ot[l.employee_id] || 0;
    if (Number(l.incentive) === inc) continue;
    const r = computeLine(run.formulas, run.month, l.snapshot, l.structure, { ...l, incentive: inc });
    const { error } = await sb.from("payroll_lines").update({ incentive: inc, ...r }).eq("id", l.id);
    if (error) fail(error.message);
    changed++;
  }
  return changed;
}

export async function addEmployeeToRun(ctx: Ctx, runId: string, employeeId: string) {
  const { sb } = ctx;
  const run = await loadRun(ctx, runId);
  editable(run);
  const { data: e } = await sb.from("employees").select("*").eq("id", employeeId).single();
  if (!e) fail("Employee not found");
  if (e.status === "Draft") fail("Draft employees can't be added to payroll. Change their status to Active first.");
  const [{ data: structs }, { count }, ot] = await Promise.all([
    sb.from("salary_structures").select("*").eq("employee_id", employeeId),
    sb.from("payroll_lines").select("id", { count: "exact", head: true }).eq("run_id", runId),
    otTotals(ctx, run.month),
  ]);
  const s = structureForMonth((structs || []) as Structure[], run.month);
  const sv = s ? structureValues(s) : null;
  const snap = snapshotOf(e as Employee);
  const inputs = blankInputs(defaultDays(e as Employee, run.month), ot[employeeId] || 0);
  const r = computeLine(run.formulas, run.month, snap, sv, inputs);
  const { data, error } = await sb.from("payroll_lines").insert({ run_id: runId, employee_id: employeeId, print_code: `C${(count || 0) + 1}`,
    snapshot: snap, structure: sv, structure_id: s?.id ?? null, ...inputs, ...r }).select("id").single();
  if (error) fail(error.message.includes("duplicate") ? "This employee is already on this month." : error.message);
  return data!.id as string;
}

/** Removes one employee from a month and renumbers the print codes. */
export async function removeLine(ctx: Ctx, lineId: string) {
  const { sb } = ctx;
  const { data: line } = await sb.from("payroll_lines").select("run_id").eq("id", lineId).single();
  if (!line) fail("Line not found");
  editable(await loadRun(ctx, line!.run_id));
  const { error } = await sb.from("payroll_lines").delete().eq("id", lineId);
  if (error) fail(error.message);
  const { data: lines } = await sb.from("payroll_lines").select("id, print_code").eq("run_id", line!.run_id);
  const sorted = (lines || []).sort((a, b) => Number(a.print_code?.slice(1)) - Number(b.print_code?.slice(1)));
  for (let i = 0; i < sorted.length; i++) if (sorted[i].print_code !== `C${i + 1}`)
    await sb.from("payroll_lines").update({ print_code: `C${i + 1}` }).eq("id", sorted[i].id);
  return line!.run_id as string;
}

export async function updateRunMeta(ctx: Ctx, runId: string, meta: { payment_date?: string | null; notes?: string | null }) {
  const row: Record<string, unknown> = {};
  if ("payment_date" in meta) {
    if (meta.payment_date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.payment_date)) fail("Payment date should look like 2026-11-02");
    row.payment_date = meta.payment_date || null;
  }
  if ("notes" in meta) row.notes = meta.notes || null;
  const { error } = await ctx.sb.from("payroll_runs").update(row).eq("id", runId);
  if (error) fail(error.message);
}

export async function finalizeRun(ctx: Ctx, runId: string) {
  const { sb, email } = ctx;
  const { data: bad } = await sb.from("payroll_lines").select("id").eq("run_id", runId).not("error", "is", null);
  if (bad?.length) fail("Fix the rows with errors before finalizing.");
  const { error } = await sb.from("payroll_runs").update({ status: "finalized", finalized_at: new Date().toISOString(), finalized_by: email }).eq("id", runId);
  if (error) fail(error.message);
}

export async function reopenRun(ctx: Ctx, runId: string) {
  const { error } = await ctx.sb.from("payroll_runs").update({ status: "draft", finalized_at: null, finalized_by: null }).eq("id", runId);
  if (error) fail(error.message);
}

export async function deleteRun(ctx: Ctx, runId: string) {
  const run = await loadRun(ctx, runId);
  if (run.status === "finalized") fail("Reopen the month before deleting it.");
  const { error } = await ctx.sb.from("payroll_runs").delete().eq("id", runId);
  if (error) fail(error.message);
}

// ───────────── OT incentives & bonus ─────────────
export async function addOt({ sb }: Ctx, e: { month: string; employee_id: string; site?: string | null; days?: number; amount?: number | null; remarks?: string | null }) {
  if (!isMonth(e.month)) fail("Month should look like 2026-10");
  const { data, error } = await sb.from("ot_incentives").insert({
    month: monthStart(e.month), employee_id: e.employee_id, site: e.site ?? null,
    days: Number(e.days) || 0, amount: e.amount == null ? null : Number(e.amount), remarks: e.remarks ?? null,
  }).select("id").single();
  if (error) fail(error.message);
  return data!.id as string;
}

export async function deleteOt({ sb }: Ctx, id: string) {
  const { error } = await sb.from("ot_incentives").delete().eq("id", id);
  if (error) fail(error.message);
}

export async function addBonus({ sb }: Ctx, b: { fy: string; period: string; employee_id: string; amount: number; transferred_on?: string | null; remarks?: string | null }) {
  const { data, error } = await sb.from("bonus_payments").insert({
    fy: b.fy, period: b.period, employee_id: b.employee_id, amount: Number(b.amount) || 0,
    transferred_on: b.transferred_on || null, remarks: b.remarks ?? null,
  }).select("id").single();
  if (error) fail(error.message);
  return data!.id as string;
}

export async function deleteBonus({ sb }: Ctx, id: string) {
  const { error } = await sb.from("bonus_payments").delete().eq("id", id);
  if (error) fail(error.message);
}

// ───────────── Settings ─────────────
export async function saveCompany({ sb }: Ctx, fields: { name?: string; address?: string | null; pan?: string | null; cin?: string | null; slip_notes?: string | null; orgzit?: Record<string, unknown> }) {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "address", "pan", "cin", "slip_notes", "orgzit"] as const) if (k in fields) row[k] = fields[k] ?? null;
  if ("name" in row && !row.name) row.name = "Spans Envirotech Pvt. Ltd.";
  const { error } = await sb.from("company_settings").update(row).eq("id", 1);
  if (error) fail(error.message);
}

export async function addAppUser({ sb }: Ctx, email: string, name: string | null) {
  email = email.trim().toLowerCase();
  if (!email.includes("@")) fail("Enter an email");
  const { error } = await sb.from("app_users").insert({ email, name });
  if (error) fail(error.message);
}

export async function removeAppUser({ sb, email: me }: Ctx, email: string) {
  if (email.toLowerCase() === me.toLowerCase()) fail("You can't remove yourself.");
  const { error } = await sb.from("app_users").delete().eq("email", email);
  if (error) fail(error.message);
}
