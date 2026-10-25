import Link from "next/link";
import { pageDb } from "@/lib/data";

const TABLES: Record<string, string> = {
  employees: "Employee", salary_structures: "Salary structure", formula_sets: "Formulas", payroll_runs: "Payroll month",
  payroll_lines: "Payroll row", ot_incentives: "OT incentive", bonus_payments: "Bonus", app_users: "User access", company_settings: "Settings",
};
const HIDE = new Set(["updated_at", "created_at", "calc", "formulas", "snapshot", "structure"]);

type Row = { id: number; at: string; actor: string | null; table_name: string; row_id: string | null; action: string; old: Record<string, unknown> | null; new: Record<string, unknown> | null };

function describe(r: Row) {
  const o = r.old || {}, n = r.new || {};
  const name = (n.name || o.name || (n.snapshot as { name?: string })?.name || (o.snapshot as { name?: string })?.name || n.email || o.email || "") as string;
  if (r.action === "REVEAL") return `Viewed ${String(n.field).replace("_", " ")} in full`;
  if (r.action === "INSERT") return `Added ${name}`.trim();
  if (r.action === "DELETE") return `Deleted ${name}`.trim();
  if (r.table_name === "payroll_runs" && o.status !== n.status) return n.status === "finalized" ? "Finalized month" : "Reopened month";
  const changed = Object.keys(n).filter((k) => !HIDE.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]));
  const sensitive = new Set(["aadhaar", "pan", "bank_account"]);
  const parts = changed.slice(0, 6).map((k) => sensitive.has(k)
    ? `${k.replace("_", " ")} changed`
    : `${k.replace(/_/g, " ")}: ${fmt(o[k])} → ${fmt(n[k])}`);
  return (name ? `${name}: ` : "") + (parts.join("; ") || "recalculated") + (changed.length > 6 ? ` (+${changed.length - 6} more)` : "");
}
const fmt = (v: unknown) => (v == null || v === "" ? "–" : typeof v === "object" ? "…" : String(v));

export default async function Audit({ searchParams }: { searchParams: { t?: string } }) {
  const { sb } = await pageDb();
  let q = sb.from("audit_log").select("*").order("at", { ascending: false }).limit(300);
  if (searchParams.t) q = q.eq("table_name", searchParams.t);
  const { data } = await q;
  const rows = (data || []) as Row[];
  return (
    <>
      <div className="pagehead">
        <div><h1>Audit log</h1><div className="muted">Every change, finalize/reopen and view of sensitive data, newest first. Entries can&apos;t be edited or deleted.</div></div>
        <Link className="btn" href="/settings">Settings</Link>
      </div>
      <div className="tabs">
        <Link href="/settings/audit" className={!searchParams.t ? "active" : ""}>All</Link>
        {Object.entries(TABLES).map(([k, l]) => <Link key={k} href={`?t=${k}`} className={searchParams.t === k ? "active" : ""}>{l}</Link>)}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="small">{r.actor}</td>
                <td className="small">{TABLES[r.table_name] ?? r.table_name}</td>
                <td className="small" style={{ whiteSpace: "normal" }}>{describe(r)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted">No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
