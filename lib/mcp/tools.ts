// Spans Payroll MCP tools. Each tool runs as the signed-in user through the shared operations in lib/ops.ts,
// so the database's access rules, finalized-month locks and audit trail apply exactly as in the web app.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as ops from "@/lib/ops";
import { OpError, type Ctx } from "@/lib/ops";
import { DEFAULT_FORMULAS, financialYear, monthLabel, thisMonthIST, validateFormulas, type FormulaRow } from "@/lib/payroll";
import { eligibleForMonth, snapshotOf, sortEmployees, structureValues, type Employee, type Structure } from "@/lib/run-logic";
import { lineChecks } from "@/lib/checks";
import { complianceSummary, hdfcCsv, type LineRow, type RunRow } from "@/lib/exports";
import { formulasForMonth, previewMonth, salaryBreakup } from "@/lib/breakup";
import { mask } from "@/lib/contact";

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): Out => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }] });
const err = (msg: string): Out => ({ content: [{ type: "text", text: msg }], isError: true });

/** Wraps a handler: user-facing errors come back as tool errors Claude can read and act on. */
function safe<A>(fn: (a: A) => Promise<Out>) {
  return async (a: A): Promise<Out> => {
    try { return await fn(a); } catch (e) {
      if (e instanceof OpError) return err(e.message);
      console.error("MCP tool error", e);
      return err(`Something went wrong: ${(e as Error).message}`);
    }
  };
}

const R = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const W = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const D = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown) => Number(v) || 0;

// ───────────── lookups ─────────────
const empRef = z.string().min(1).describe('Employee: id, employee # (e.g. "Emp 14" or "14") or name (or part of it)');
const monthRef = z.string().min(1).describe('Payroll month as YYYY-MM (e.g. "2026-10"), or the month\'s id');

async function findEmployee({ sb }: Ctx, ref: string) {
  ref = ref.trim();
  const { data } = await sb.from("employees").select("*");
  const all = (data || []) as (Employee & Record<string, unknown>)[];
  if (UUID.test(ref)) { const e = all.find((x) => x.id === ref); if (e) return e; }
  const code = /^\d+$/.test(ref) ? `emp ${ref}` : ref.toLowerCase().replace(/\s+/g, " ");
  const byCode = all.filter((x) => x.emp_code.toLowerCase().replace(/\s+/g, " ") === code);
  if (byCode.length === 1) return byCode[0];
  const exact = all.filter((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (exact.length === 1) return exact[0];
  const part = all.filter((x) => x.name.toLowerCase().includes(ref.toLowerCase()));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new OpError(`"${ref}" matches several employees: ${part.map((x) => `${x.name} (${x.emp_code})`).join(", ")}. Use the employee #.`);
  throw new OpError(`No employee matches "${ref}".`);
}

async function findRun({ sb }: Ctx, ref: string) {
  ref = ref.trim();
  const q = UUID.test(ref) ? sb.from("payroll_runs").select("*").eq("id", ref)
    : ops.isMonth(ref) ? sb.from("payroll_runs").select("*").eq("month", ops.monthStart(ref)) : null;
  if (!q) throw new OpError(`"${ref}" isn't a month. Use YYYY-MM, e.g. 2026-10.`);
  const { data } = await q.maybeSingle();
  if (!data) throw new OpError(`No payroll for ${UUID.test(ref) ? "that id" : monthLabel(ops.monthStart(ref))} yet. Use create_payroll_month to start it.`);
  return data as ops.Run & { finalized_at: string | null; finalized_by: string | null; formula_set_id: string | null };
}

async function findLine(ctx: Ctx, runId: string, ref: string) {
  const e = await findEmployee(ctx, ref);
  const { data } = await ctx.sb.from("payroll_lines").select("*").eq("run_id", runId).eq("employee_id", e.id).maybeSingle();
  if (!data) throw new OpError(`${e.name} isn't on this month's payroll. Use add_employee_to_month first.`);
  return { line: data, employee: e };
}

// ───────────── shaping (sensitive numbers are masked) ─────────────
function employeeOut(e: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === null || v === "" || ["created_at", "updated_at"].includes(k)) continue;
    o[k] = (ops.SENSITIVE as readonly string[]).includes(k) ? mask(String(v)) : v;
  }
  return o;
}

function lineOut(l: LineRow & Record<string, unknown>) {
  const c = (l.calc || {}) as Record<string, number>;
  return {
    line_id: l.id, code: l.print_code, employee: l.snapshot.name, emp_code: l.snapshot.emp_code, employee_id: l.employee_id,
    days: { worked: num(l.working_days), offs: num(l.paid_offs), paid_leave: num(l.leaves), lop: num(l.lop_days) },
    inputs: {
      incentive: num(l.incentive), arrears: num(l.arrears), ex_gratia: num(l.ex_gratia), advance_recovery: num(l.advance_recovery),
      other_deduction: num(l.other_deduction), manual_adjustment: num(l.manual_adjustment), professional_tax_manual: num(l.professional_tax),
    },
    gross: num(l.gross), deductions: num(c.total_deductions), in_hand: num(l.net_pay), ctc: num(l.ctc),
    ...(l.remarks ? { remarks: l.remarks } : {}), ...(l.error ? { error: l.error } : {}),
  };
}

function downloads(base: string, runId: string, locked: boolean) {
  return {
    note: "Links open in the browser and need you to be signed in to the payroll app.",
    slips_pdf: `${base}/api/runs/${runId}/slips`, slips_zip: `${base}/api/runs/${runId}/slips-zip`,
    register_csv: `${base}/api/runs/${runId}/register`,
    ...(locked ? { hdfc_csv: `${base}/api/runs/${runId}/hdfc`, orgzit_csv: `${base}/api/runs/${runId}/orgzit` }
      : { hdfc_and_orgzit: "Available after the month is finalized." }),
    month_page: `${base}/payroll/${runId}`,
  };
}

// ───────────── tools ─────────────
export function registerTools(server: McpServer, ctx: Ctx, base: string) {
  const { sb } = ctx;
  const tool = <S extends z.ZodRawShape>(name: string, title: string, description: string, shape: S,
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint?: boolean }, fn: (a: z.objectOutputType<S, z.ZodTypeAny>) => Promise<Out>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.registerTool(name, { title, description, inputSchema: shape, annotations: { title, ...annotations } }, safe(fn) as any);

  // ── who / overview
  tool("whoami", "Who am I", "Shows which login this connection acts as and the current payroll status (latest months, active staff).", {}, R, async () => {
    const [{ data: runs }, { data: emps }] = await Promise.all([
      sb.from("payroll_runs").select("month, status").order("month", { ascending: false }).limit(3),
      sb.from("employees").select("status"),
    ]);
    const count = (s: string) => (emps || []).filter((e) => e.status === s).length;
    return ok({ signed_in_as: ctx.email, app: base, today: new Date().toISOString().slice(0, 10), current_month: thisMonthIST().slice(0, 7),
      employees: { active: count("Active"), draft: count("Draft"), past: count("Inactive") },
      latest_months: (runs || []).map((r) => ({ month: r.month.slice(0, 7), status: r.status })) });
  });

  // ── employees
  tool("list_employees", "List employees",
    "Lists employees with their status, designation, location and current gross salary. Bank, Aadhaar and PAN numbers are masked.",
    { status: z.enum(["Active", "Draft", "Inactive", "All"]).default("Active").describe("Active = current staff, Draft = candidates not yet joined, Inactive = past employees"),
      search: z.string().optional().describe("Filter by part of the name, employee #, designation or location") }, R,
    async ({ status, search }) => {
      const [{ data: emps }, { data: structs }] = await Promise.all([sb.from("employees").select("*"), sb.from("salary_structures").select("*")]);
      const s = (search || "").toLowerCase();
      const list = sortEmployees((emps || []) as Employee[])
        .filter((e) => status === "All" || e.status === status)
        .filter((e) => !s || [e.name, e.emp_code, e.designation, e.location].some((x) => (x || "").toLowerCase().includes(s)));
      return ok(list.map((e) => {
        const cur = (structs || []).filter((x) => x.employee_id === e.id).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
        const gross = cur ? ops.COMPONENT_KEYS.reduce((a, k) => a + num(cur[k]), 0) : null;
        return { id: e.id, emp_code: e.emp_code, name: e.name, status: e.status, designation: e.designation, location: e.location,
          state: (e as Record<string, unknown>).state ?? null, date_of_joining: e.date_of_joining, date_of_leaving: e.date_of_leaving,
          gross_monthly: gross, salary_from: cur?.effective_from ?? null };
      }));
    });

  tool("get_employee", "Get employee", "All details of one employee (sensitive numbers masked) plus their salary revisions.", { employee: empRef }, R,
    async ({ employee }) => {
      const e = await findEmployee(ctx, employee);
      const [{ data: structs }, { count }] = await Promise.all([
        sb.from("salary_structures").select("*").eq("employee_id", e.id).order("effective_from", { ascending: false }),
        sb.from("payroll_lines").select("id", { count: "exact", head: true }).eq("employee_id", e.id),
      ]);
      return ok({ ...employeeOut(e), payroll_months: count || 0, salary_revisions: (structs || []).map((s) => ({
        id: s.id, effective_from: s.effective_from, ...Object.fromEntries(ops.COMPONENT_KEYS.map((k) => [k, num(s[k])])),
        gross: ops.COMPONENT_KEYS.reduce((a, k) => a + num(s[k]), 0),
        applicable: ops.FLAG_KEYS.filter((k) => s[k]).map((k) => k.replace("_applicable", "")), extras: s.extras, remarks: s.remarks })),
        page: `${base}/employees/${e.id}` });
    });

  tool("reveal_employee_number", "Reveal a sensitive number",
    "Shows one employee's full bank account, Aadhaar or PAN number. Every reveal is recorded in the audit log. Only use when the person asks for the full number.",
    { employee: empRef, field: z.enum(ops.SENSITIVE) }, R,
    async ({ employee, field }) => {
      const e = await findEmployee(ctx, employee);
      return ok({ employee: e.name, field, value: await ops.revealSensitive(ctx, e.id, field), note: "Recorded in the audit log." });
    });

  const empFields = {
    emp_code: z.string().optional().describe('Employee #, e.g. "Emp 52"'), name: z.string().optional(), father_name: z.string().optional(),
    designation: z.string().optional(), location: z.string().optional().describe("Site / city"),
    state: z.string().optional().describe("State for PT/LWF rules, e.g. Haryana, Karnataka, Delhi"),
    status: z.enum(["Active", "Draft", "Inactive"]).optional().describe("Draft = candidate not yet joined (never put on payroll)"),
    dob: z.string().optional().describe("YYYY-MM-DD"), date_of_joining: z.string().optional().describe("YYYY-MM-DD"),
    date_of_leaving: z.string().optional().describe("YYYY-MM-DD; setting it on an Active employee makes them Inactive"),
    mobile: z.string().optional(), email: z.string().optional(), bank_advice_email: z.string().optional().describe("Email put in the HDFC file"),
    bank_account: z.string().optional(), ifsc: z.string().optional(), bank_name: z.string().optional(),
    aadhaar: z.string().optional(), pan: z.string().optional(), uan: z.string().optional(), esic_number: z.string().optional(),
    blood_group: z.string().optional(), orgzit_description: z.string().optional(), orgzit_id: z.string().optional(),
    joining_letter_url: z.string().optional().describe("Google Drive link (https://…)"), notes: z.string().optional(),
    include_in_bank_file: z.boolean().optional().describe("false for people paid outside the HDFC file (e.g. directors)"),
    sort_order: z.number().optional(),
  };
  const clean = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));

  tool("create_employee", "Add employee",
    "Adds a new employee or candidate. emp_code and name are required. Use status Draft for a candidate who hasn't joined; add their salary with save_salary_revision.",
    empFields, W, async (f) => {
      const id = await ops.saveEmployee(ctx, null, clean(f));
      return ok({ created: true, id, page: `${base}/employees/${id}`, next: "Add their salary with save_salary_revision." });
    });

  tool("update_employee", "Update employee",
    "Changes an employee's details. Only the fields you pass are changed. To mark someone as left, set date_of_leaving (and status Inactive).",
    { employee: empRef, ...empFields }, W, async ({ employee, ...f }) => {
      const e = await findEmployee(ctx, employee);
      await ops.saveEmployee(ctx, e.id, clean(f));
      return ok({ updated: e.name, changed: Object.keys(clean(f)), note: "Open payroll months keep the old details until recalculated with refresh_details." });
    });

  tool("delete_employee", "Delete employee",
    "Permanently deletes an employee who has never been on a payroll (e.g. a candidate who didn't join). People with payroll history can't be deleted; mark them Inactive instead.",
    { employee: empRef }, D, async ({ employee }) => {
      const e = await findEmployee(ctx, employee);
      await ops.deleteEmployee(ctx, e.id);
      return ok({ deleted: e.name });
    });

  // ── salary revisions
  const components = Object.fromEntries(ops.COMPONENT_KEYS.map((k) => [k, z.number().min(0).optional()])) as Record<(typeof ops.COMPONENT_KEYS)[number], z.ZodOptional<z.ZodNumber>>;
  const flags = Object.fromEntries(ops.FLAG_KEYS.map((k) => [k, z.boolean().optional()])) as Record<(typeof ops.FLAG_KEYS)[number], z.ZodOptional<z.ZodBoolean>>;

  tool("save_salary_revision", "Save salary revision",
    "Adds (or overwrites, if the date already exists) a salary revision. Monthly amounts in rupees: basic, hra, medical, conveyance, mobile, " +
    "site_allowance, supervisor_allowance, overtime (fixed OT / leave salary). Anything you leave out is copied from the latest revision " +
    "(set copy_from_latest false to start from zero). Returns the new monthly and yearly break-up compared with the previous revision.",
    { employee: empRef, effective_from: z.string().describe("YYYY-MM-DD, normally the 1st of a month"), ...components, ...flags,
      extras: z.record(z.number()).optional().describe("Custom amounts used by custom formulas, e.g. {\"food_allowance\": 1000}"),
      remarks: z.string().optional().describe('e.g. "Increment Nov 2026"'),
      copy_from_latest: z.boolean().default(true) }, W,
    async ({ employee, effective_from, extras, remarks, copy_from_latest, ...vals }) => {
      const e = await findEmployee(ctx, employee);
      const { data: structs } = await sb.from("salary_structures").select("*").eq("employee_id", e.id).order("effective_from", { ascending: false });
      const base0 = copy_from_latest ? (structs || []).find((s) => s.effective_from <= effective_from) ?? structs?.[0] : null;
      const input: ops.StructureInput = { employee_id: e.id, effective_from, remarks: remarks ?? null, extras: extras ?? base0?.extras ?? {} };
      const v = vals as Record<string, number | boolean | undefined>;
      for (const k of ops.COMPONENT_KEYS) input[k] = (v[k] as number | undefined) ?? num(base0?.[k]);
      for (const k of ops.FLAG_KEYS) input[k] = (v[k] as boolean | undefined) ?? !!base0?.[k];
      const id = await ops.saveStructure(ctx, input);
      return ok({ saved: `${e.name} from ${effective_from}`, revision_id: id, ...(await breakupFor(e, id)),
        note: "An open payroll month picks this up after recalculate_month (refresh_structures is on by default)." });
    });

  tool("delete_salary_revision", "Delete salary revision", "Deletes one salary revision by its id (see get_employee). Finalized months are not affected.",
    { revision_id: z.string().uuid() }, D, async ({ revision_id }) => {
      await ops.deleteStructure(ctx, revision_id);
      return ok({ deleted: revision_id });
    });

  async function breakupFor(e: Employee & Record<string, unknown>, revisionId?: string) {
    const [{ data: structs }, { data: sets }] = await Promise.all([
      sb.from("salary_structures").select("*").eq("employee_id", e.id).order("effective_from", { ascending: false }),
      sb.from("formula_sets").select("effective_from, formulas"),
    ]);
    const list = structs || [];
    const i = revisionId ? list.findIndex((s) => s.id === revisionId) : 0;
    if (i < 0 || !list[i]) throw new OpError(`${e.name} has no salary revision${revisionId ? " with that id" : " yet"}.`);
    const s = list[i], prev = list[i + 1];
    const month = previewMonth(s.effective_from, thisMonthIST());
    const formulas = formulasForMonth(sets, month, DEFAULT_FORMULAS);
    const b = salaryBreakup(formulas, month, snapshotOf(e), structureValues(s as Structure));
    if (b.error) throw new OpError(b.error);
    const p = prev ? salaryBreakup(formulas, month, snapshotOf(e), structureValues(prev as Structure)) : null;
    const rows = (r: { key: string; label: string; monthly: number; annual: number }[]) => r.map((x) => ({ item: x.label, monthly: x.monthly, yearly: x.annual }));
    return {
      breakup: {
        basis: `Full month of ${monthLabel(month)} with no LOP or OT; yearly = 12 months from then.`,
        earnings: rows(b.earnings), gross: b.gross, deductions: rows(b.deductions), total_deductions: b.deductionsTotal,
        in_hand: b.net, company_contributions: rows(b.employer), ctc: b.ctc,
        ...(p && !p.error ? { previous_revision: { effective_from: prev!.effective_from, gross: p.gross.monthly, in_hand: p.net.monthly, ctc: p.ctc.monthly },
          change_per_month: { gross: b.gross.monthly - p.gross.monthly, in_hand: b.net.monthly - p.net.monthly, ctc: b.ctc.monthly - p.ctc.monthly } } : {}),
      },
      pdf: `${base}/api/employees/${e.id}/draft-slip?structure=${s.id}`,
    };
  }

  tool("preview_salary", "Preview salary break-up",
    "Monthly and yearly break-up for an employee's salary revision (default: latest): earnings, deductions, in-hand, company contributions and CTC, " +
    "compared with the previous revision. For Draft candidates this is the proposed salary.",
    { employee: empRef, revision_id: z.string().uuid().optional() }, R, async ({ employee, revision_id }) => {
      const e = await findEmployee(ctx, employee);
      return ok({ employee: e.name, status: e.status, ...(await breakupFor(e, revision_id)) });
    });

  // ── payroll months
  tool("list_payroll_months", "List payroll months", "All payroll months with status, headcount and totals.", {}, R, async () => {
    const [{ data: runs }, { data: lines }] = await Promise.all([
      sb.from("payroll_runs").select("id, month, status, payment_date, finalized_at, finalized_by").order("month", { ascending: false }),
      sb.from("payroll_lines").select("run_id, gross, net_pay, ctc"),
    ]);
    return ok((runs || []).map((r) => {
      const ls = (lines || []).filter((l) => l.run_id === r.id);
      return { month: r.month.slice(0, 7), id: r.id, status: r.status, payment_date: r.payment_date, employees: ls.length,
        gross: ls.reduce((a, l) => a + num(l.gross), 0), in_hand: ls.reduce((a, l) => a + num(l.net_pay), 0), ctc: ls.reduce((a, l) => a + num(l.ctc), 0) };
    }));
  });

  tool("get_payroll_month", "Get payroll month",
    "One month's payroll: every employee's days, inputs, gross, deductions and in-hand; totals; PF/ESI/LWF/PT summary; the same checks the app shows " +
    "(day totals, missing people, bank changes, ESI limits, 50% deduction rule); and download links.",
    { month: monthRef }, R, async ({ month }) => {
      const run = await findRun(ctx, month);
      const [{ data: raw }, { data: emps }, { data: prevRuns }, { data: settings }] = await Promise.all([
        sb.from("payroll_lines").select("*").eq("run_id", run.id), sb.from("employees").select("*"),
        sb.from("payroll_runs").select("id").lt("month", run.month).order("month", { ascending: false }).limit(1),
        sb.from("company_settings").select("orgzit").eq("id", 1).single(),
      ]);
      const lines = ((raw || []) as (LineRow & { employee_id: string })[]).sort((a, b) => Number(a.print_code?.slice(1)) - Number(b.print_code?.slice(1)));
      const { data: prevLines } = prevRuns?.[0] ? await sb.from("payroll_lines").select("employee_id, snapshot").eq("run_id", prevRuns[0].id) : { data: [] };
      const previousBank = Object.fromEntries((prevLines || []).map((p) => [p.employee_id, (p.snapshot as { bank_account?: string | null })?.bank_account ?? null]));
      const esiCeiling = Number((run.formulas || []).find((f) => f.key === "esi_wage_ceiling")?.expr) || 21000;
      const present = new Set(lines.map((l) => l.employee_id));
      const missing = sortEmployees((emps || []) as Employee[]).filter((e) => !present.has(e.id) && e.status !== "Draft" && eligibleForMonth(e, run.month));
      const fy = financialYear(run.month);
      const warnings = [
        ...lineChecks(run.month, lines, { esiCeiling, previousBank }).map((c) => `${c.level === "error" ? "ERROR " : ""}${c.who}: ${c.text}`),
        ...(missing.length ? [`Employed this month but not on this payroll: ${missing.map((e) => e.name).join(", ")}`] : []),
        ...lines.filter((l) => l.snapshot.include_in_bank_file && (!l.snapshot.bank_account || !l.snapshot.ifsc)).map((l) => `${l.snapshot.name}: missing bank details (left out of the HDFC file)`),
        ...lines.filter((l) => !l.snapshot.orgzit_id).map((l) => `${l.snapshot.name}: no Orgzit ID`),
        ...(!(settings?.orgzit as { fy_ids?: Record<string, string> })?.fy_ids?.[fy] ? [`No Orgzit "Financial Year" ID for ${fy} (Settings)`] : []),
      ];
      const bank = hdfcCsv(run as unknown as RunRow, lines.filter((l) => !l.error));
      const locked = run.status === "finalized";
      return ok({
        month: run.month.slice(0, 7), id: run.id, status: run.status, payment_date: run.payment_date, notes: run.notes,
        ...(locked ? { finalized_by: run.finalized_by, finalized_at: run.finalized_at } : {}),
        totals: { employees: lines.length, gross: lines.reduce((a, l) => a + num(l.gross), 0), in_hand: lines.reduce((a, l) => a + num(l.net_pay), 0),
          ctc: lines.reduce((a, l) => a + num(l.ctc), 0), hdfc_file: { people: bank.count, amount: bank.total, left_out: bank.skipped } },
        warnings, lines: lines.map((l) => lineOut(l as LineRow & Record<string, unknown>)), statutory: complianceSummary(lines),
        downloads: downloads(base, run.id, locked),
      });
    });

  tool("get_payroll_line", "Get one employee's calculation",
    "Full calculation for one employee in one month: every formula result (earnings, PF/ESI/LWF/PT, employer costs), the salary used and the slip link.",
    { month: monthRef, employee: empRef }, R, async ({ month, employee }) => {
      const run = await findRun(ctx, month);
      const { line } = await findLine(ctx, run.id, employee);
      const labels = Object.fromEntries((run.formulas || []).map((f) => [f.key, f.label]));
      const calc = Object.fromEntries(Object.entries((line.calc || {}) as Record<string, number>)
        .filter(([k]) => !(run.formulas || []).find((f) => f.key === k && f.category === "parameter"))
        .map(([k, v]) => [labels[k] ? `${labels[k]} (${k})` : k, v]));
      return ok({ month: run.month.slice(0, 7), status: run.status, ...lineOut(line), salary_used: line.structure, calculation: calc,
        slip_pdf: `${base}/api/lines/${line.id}/slip` });
    });

  tool("create_payroll_month", "Start payroll month",
    "Starts a month's payroll: adds every employee working that month (Draft candidates excluded) with days pre-filled (Sundays as offs, LOP for days " +
    "before joining / after leaving), OT incentives pulled in, and the formula version in force. Returns the month with its checks.",
    { month: z.string().describe("YYYY-MM"), payment_date: z.string().optional().describe("Bank transfer date YYYY-MM-DD") }, W,
    async ({ month, payment_date }) => {
      const r = await ops.createRun(ctx, month, payment_date ?? null);
      return ok({ created: monthLabel(ops.monthStart(month)), id: r.id, employees: r.employees, page: `${base}/payroll/${r.id}`,
        next: "Enter attendance changes with update_payroll_line, then review with get_payroll_month." });
    });

  const lineInputs = {
    working_days: z.number().min(0).optional(), paid_offs: z.number().min(0).optional().describe("Weekly offs and paid holidays"),
    leaves: z.number().min(0).optional().describe("Paid leave days"), lop_days: z.number().min(0).optional().describe("Loss-of-pay days"),
    incentive: z.number().min(0).optional().describe("Incentive / OT amount for the month (replaces the current value)"),
    arrears: z.number().min(0).optional(), ex_gratia: z.number().min(0).optional(),
    advance_recovery: z.number().min(0).optional(), other_deduction: z.number().min(0).optional().describe("Give the reason in remarks"),
    manual_adjustment: z.number().optional().describe("Other addition (+) or adjustment (−) to in-hand; give the reason in remarks"),
    professional_tax: z.number().min(0).optional().describe("Manual professional tax, added to any automatic PT"),
    remarks: z.string().optional(),
  };

  tool("update_payroll_line", "Update an employee's month",
    "Changes one employee's attendance or amounts for a draft month and recalculates. Only the values you pass change. " +
    "Days normally add up to the days in the month (worked + offs + paid leave + LOP).",
    { month: monthRef, employee: empRef, ...lineInputs }, W, async ({ month, employee, ...inputs }) => {
      const run = await findRun(ctx, month);
      const { line } = await findLine(ctx, run.id, employee);
      const saved = await ops.saveLine(ctx, line.id, clean(inputs));
      const before = { gross: num(line.gross), in_hand: num(line.net_pay) };
      return ok({ updated: lineOut(saved), before });
    });

  tool("add_employee_to_month", "Add employee to month", "Adds an employee (Active or past, not Draft) to a draft month with days pre-filled.",
    { month: monthRef, employee: empRef }, W, async ({ month, employee }) => {
      const run = await findRun(ctx, month);
      const e = await findEmployee(ctx, employee);
      const id = await ops.addEmployeeToRun(ctx, run.id, e.id);
      const { data } = await sb.from("payroll_lines").select("*").eq("id", id).single();
      return ok({ added: lineOut(data) });
    });

  tool("remove_employee_from_month", "Remove employee from month", "Removes an employee's row from a draft month (print codes are renumbered).",
    { month: monthRef, employee: empRef }, D, async ({ month, employee }) => {
      const run = await findRun(ctx, month);
      const { line, employee: e } = await findLine(ctx, run.id, employee);
      await ops.removeLine(ctx, line.id);
      return ok({ removed: e.name, month: run.month.slice(0, 7) });
    });

  tool("recalculate_month", "Recalculate month",
    "Recalculates a draft month, keeping all days and amounts entered, and adds anyone newly eligible. Use after salary revisions, " +
    "employee detail changes or a new formula version.",
    { month: monthRef,
      refresh_structures: z.boolean().default(true).describe("Use salary revisions as they stand now"),
      refresh_details: z.boolean().default(false).describe("Copy current employee details (name, bank, UAN…) into the month"),
      use_latest_formulas: z.boolean().default(false).describe("Switch to the formula version now in force for this month") }, W,
    async ({ month, refresh_structures, refresh_details, use_latest_formulas }) => {
      const run = await findRun(ctx, month);
      const r = await ops.refreshRun(ctx, run.id, { refreshStructures: refresh_structures, refreshDetails: refresh_details, useLatestFormulas: use_latest_formulas });
      return ok({ month: run.month.slice(0, 7), recalculated: r.updated, added: r.added });
    });

  tool("pull_ot_incentives", "Pull OT incentives into month", "Sets each employee's Incentive for a draft month to their total OT incentive entries for that month.",
    { month: monthRef }, W, async ({ month }) => {
      const run = await findRun(ctx, month);
      return ok({ month: run.month.slice(0, 7), employees_changed: await ops.pullOtIncentives(ctx, run.id) });
    });

  tool("update_month_details", "Update month details", "Sets a draft month's bank transfer date and/or notes.",
    { month: monthRef, payment_date: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear"), notes: z.string().nullable().optional() }, W,
    async ({ month, ...meta }) => {
      const run = await findRun(ctx, month);
      await ops.updateRunMeta(ctx, run.id, clean(meta));
      return ok({ month: run.month.slice(0, 7), updated: Object.keys(clean(meta)) });
    });

  tool("finalize_month", "Finalize and lock month",
    "Finalizes and locks a month so figures can't change; the HDFC and Orgzit files become available. Review get_payroll_month warnings and confirm with the person first.",
    { month: monthRef }, { ...W, idempotentHint: true }, async ({ month }) => {
      const run = await findRun(ctx, month);
      if (run.status === "finalized") return ok({ month: run.month.slice(0, 7), status: "already finalized" });
      await ops.finalizeRun(ctx, run.id);
      return ok({ finalized: run.month.slice(0, 7), downloads: downloads(base, run.id, true) });
    });

  tool("reopen_month", "Reopen month",
    "Reopens a finalized month for editing (recorded in the audit log). If the HDFC file was already uploaded to the bank, don't upload it again.",
    { month: monthRef }, D, async ({ month }) => {
      const run = await findRun(ctx, month);
      await ops.reopenRun(ctx, run.id);
      return ok({ reopened: run.month.slice(0, 7) });
    });

  tool("delete_month", "Delete payroll month", "Deletes a draft month's whole payroll, including all days and amounts entered. Finalized months can't be deleted.",
    { month: monthRef }, D, async ({ month }) => {
      const run = await findRun(ctx, month);
      await ops.deleteRun(ctx, run.id);
      return ok({ deleted: run.month.slice(0, 7) });
    });

  // ── OT incentives
  tool("list_ot_entries", "List OT incentive entries", "OT / site incentive entries for a month, with the total per employee.",
    { month: z.string().describe("YYYY-MM") }, R, async ({ month }) => {
      if (!ops.isMonth(month)) throw new OpError("Month should look like 2026-10");
      const [{ data }, { data: emps }] = await Promise.all([
        sb.from("ot_incentives").select("*").eq("month", ops.monthStart(month)), sb.from("employees").select("id, name, emp_code"),
      ]);
      const name = (id: string) => emps?.find((e) => e.id === id)?.name ?? id;
      return ok((data || []).map((o) => ({ id: o.id, employee: name(o.employee_id), site: o.site, days: num(o.days), amount: o.amount == null ? null : num(o.amount), remarks: o.remarks })));
    });

  tool("add_ot_entry", "Add OT incentive entry",
    "Adds an OT / site incentive entry. Give the amount, or days worked extra (the app suggests salary ÷ days × days). Pull it into the month with pull_ot_incentives.",
    { month: z.string().describe("YYYY-MM"), employee: empRef, amount: z.number().min(0).optional(), days: z.number().min(0).optional(),
      site: z.string().optional(), remarks: z.string().optional() }, W, async ({ employee, ...o }) => {
      const e = await findEmployee(ctx, employee);
      const id = await ops.addOt(ctx, { ...o, employee_id: e.id, amount: o.amount ?? null });
      return ok({ added: id, employee: e.name, next: "If the month is already started, run pull_ot_incentives." });
    });

  tool("delete_ot_entry", "Delete OT incentive entry", "Deletes one OT incentive entry by id (see list_ot_entries).",
    { id: z.string().uuid() }, D, async ({ id }) => { await ops.deleteOt(ctx, id); return ok({ deleted: id }); });

  // ── bonus
  tool("list_bonus_payments", "List bonus payments", "Bonus payments recorded, optionally for one financial year.",
    { fy: z.string().optional().describe('e.g. "FY2026-27"') }, R, async ({ fy }) => {
      let q = sb.from("bonus_payments").select("*");
      if (fy) q = q.eq("fy", fy);
      const [{ data }, { data: emps }] = await Promise.all([q, sb.from("employees").select("id, name")]);
      const name = (id: string) => emps?.find((e) => e.id === id)?.name ?? id;
      return ok((data || []).map((b) => ({ id: b.id, fy: b.fy, period: b.period, employee: name(b.employee_id), amount: num(b.amount), transferred_on: b.transferred_on, remarks: b.remarks })));
    });

  tool("add_bonus_payment", "Record bonus payment", "Records a bonus payment for an employee.",
    { employee: empRef, fy: z.string().describe('e.g. "FY2026-27"'), period: z.string().describe('e.g. "Apr–Sep 2026"'), amount: z.number().min(0),
      transferred_on: z.string().optional().describe("YYYY-MM-DD"), remarks: z.string().optional() }, W, async ({ employee, ...b }) => {
      const e = await findEmployee(ctx, employee);
      return ok({ added: await ops.addBonus(ctx, { ...b, employee_id: e.id }), employee: e.name });
    });

  tool("delete_bonus_payment", "Delete bonus payment", "Deletes one bonus payment by id (see list_bonus_payments).",
    { id: z.string().uuid() }, D, async ({ id }) => { await ops.deleteBonus(ctx, id); return ok({ deleted: id }); });

  // ── formulas
  tool("list_formula_versions", "List formula versions", "Formula versions with the month each starts from and which payroll months use them.", {}, R, async () => {
    const [{ data }, { data: runs }] = await Promise.all([
      sb.from("formula_sets").select("id, effective_from, name, notes").order("effective_from", { ascending: false }),
      sb.from("payroll_runs").select("month, status, formula_set_id"),
    ]);
    return ok((data || []).map((f) => ({ ...f, used_by: (runs || []).filter((r) => r.formula_set_id === f.id).map((r) => `${r.month.slice(0, 7)} (${r.status})`) })));
  });

  tool("get_formula_version", "Get formula version",
    "All formulas in a version: parameters (rates, ceilings), working values, earnings, deductions, employer costs and totals, with their expressions.",
    { version: z.string().describe("Version id, or a month YYYY-MM to get the version in force then") }, R, async ({ version }) => {
      const { data: sets } = await sb.from("formula_sets").select("*");
      const f = UUID.test(version) ? sets?.find((s) => s.id === version)
        : (sets || []).filter((s) => s.effective_from <= `${version.slice(0, 7)}-31`).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0];
      if (!f) throw new OpError("No formula version found.");
      return ok({ id: f.id, name: f.name, effective_from: f.effective_from, notes: f.notes, formulas: f.formulas });
    });

  tool("update_formula", "Change one formula or rate",
    "Changes one row of a formula version, e.g. a rate (pf_wage_ceiling → 25000) or an expression. Versions used by a finalized month can't be changed: " +
    "create a new version with save_formula_version instead. Draft months keep their own copy until recalculate_month with use_latest_formulas.",
    { version_id: z.string().uuid(), key: z.string(), expr: z.string().optional(), label: z.string().optional(), on_slip: z.boolean().optional() }, W,
    async ({ version_id, key, ...ch }) => {
      const { data: f } = await sb.from("formula_sets").select("*").eq("id", version_id).single();
      if (!f) throw new OpError("Formula version not found.");
      const rows = (f.formulas as FormulaRow[]).map((r) => (r.key === key ? { ...r, ...clean(ch) } : r));
      if (!rows.some((r) => r.key === key)) throw new OpError(`No formula "${key}" in this version.`);
      await ops.saveFormulaSet(ctx, { id: f.id, effective_from: f.effective_from, name: f.name, notes: f.notes, formulas: rows });
      return ok({ updated: key, version: f.name, now: rows.find((r) => r.key === key) });
    });

  tool("save_formula_version", "Save formula version",
    "Creates a new formula version (or replaces one by id) from a full list of formula rows. Effective from must be the 1st of a month. " +
    "Tip: start from get_formula_version and change what you need. The set is validated before saving.",
    { id: z.string().uuid().optional(), effective_from: z.string().describe("YYYY-MM-01"), name: z.string(), notes: z.string().optional(),
      formulas: z.array(z.object({ key: z.string(), label: z.string(), expr: z.string(),
        category: z.enum(["parameter", "working", "earning", "deduction", "employer", "total"]), on_slip: z.boolean().optional() })) }, W,
    async (input) => {
      const problems = validateFormulas(input.formulas as FormulaRow[]);
      if (problems.length) return err(`Not saved. Problems:\n- ${problems.join("\n- ")}`);
      const id = await ops.saveFormulaSet(ctx, { ...input, formulas: input.formulas as FormulaRow[] });
      return ok({ saved: input.name, id, effective_from: input.effective_from });
    });

  tool("delete_formula_version", "Delete formula version", "Deletes a formula version that no finalized month uses.",
    { version_id: z.string().uuid() }, D, async ({ version_id }) => { await ops.deleteFormulaSet(ctx, version_id); return ok({ deleted: version_id }); });

  // ── settings & audit
  tool("get_company_settings", "Get company settings", "Company name, address, PAN/CIN and slip notes, Orgzit upload settings, and who can sign in.", {}, R, async () => {
    const [{ data: c }, { data: users }] = await Promise.all([sb.from("company_settings").select("*").eq("id", 1).single(), sb.from("app_users").select("email, name")]);
    return ok({ ...c, users_who_can_sign_in: users, note: "Sign-in users are managed in the app's Settings page only." });
  });

  tool("update_company_settings", "Update company settings", "Changes the company details printed on slips. Only the fields you pass change.",
    { name: z.string().optional(), address: z.string().optional(), pan: z.string().optional(), cin: z.string().optional(),
      slip_notes: z.string().optional().describe("Notes printed at the bottom of every slip, one per line") }, W, async (f) => {
      await ops.saveCompany(ctx, clean(f));
      return ok({ updated: Object.keys(clean(f)) });
    });

  tool("list_audit_log", "Audit log", "Recent changes: who changed what and when (including changes made through this connection).",
    { limit: z.number().int().min(1).max(200).default(30), table: z.string().optional().describe("e.g. employees, payroll_lines, salary_structures") }, R,
    async ({ limit, table }) => {
      let q = sb.from("audit_log").select("at, actor, table_name, action, row_id, old, new").order("at", { ascending: false }).limit(limit);
      if (table) q = q.eq("table_name", table);
      const { data } = await q;
      return ok((data || []).map((a) => {
        const changed = a.action === "UPDATE" && a.old && a.new
          ? Object.keys(a.new).filter((k) => JSON.stringify(a.new[k]) !== JSON.stringify(a.old[k]) && !["updated_at", "calc"].includes(k)) : undefined;
        return { at: a.at, by: a.actor, table: a.table_name, action: a.action, ...(changed ? { changed } : {}),
          what: a.new?.name ?? a.old?.name ?? a.new?.snapshot?.name ?? a.new?.field ?? a.row_id };
      }));
    });
}

export const SERVER_INSTRUCTIONS = `Spans Payroll (Spans Envirotech Pvt. Ltd.): employees, salary revisions, monthly payroll, OT incentives, bonus and pay formulas.
- Amounts are monthly rupees. Months are YYYY-MM. Employees can be named by employee # ("Emp 14"), name or id.
- Monthly flow: create_payroll_month → update_payroll_line for attendance/LOP/incentives → get_payroll_month (review warnings) → finalize_month → downloads.
- After changing a salary or employee details, an open month needs recalculate_month.
- Finalized months are locked; reopen_month first (only if the person asks).
- Bank, Aadhaar and PAN numbers are masked; reveal_employee_number shows one in full and is audited. Don't reveal unless asked.
- Confirm with the person before finalize_month, reopen_month, delete_* or remove_employee_from_month.
- Statutory figures (PF/ESI/LWF/PT) come from the formula versions; don't change them without the person's instruction.`;
