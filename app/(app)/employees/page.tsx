import Link from "next/link";
import { pageDb, fmtDate } from "@/lib/data";
import { inr } from "@/lib/payroll";
import { sortEmployees, structureForMonth, type Structure } from "@/lib/run-logic";
import { waNumber } from "@/components/SendSlip";

export default async function Employees({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  const { sb } = await pageDb();
  const status = searchParams.status || "Active";
  const q = (searchParams.q || "").toLowerCase();
  const { data: emps } = await sb.from("employees").select("*");
  const { data: structs } = await sb.from("salary_structures").select("*");
  const today = new Date().toISOString().slice(0, 7) + "-01";
  const counts: Record<string, number> = { All: (emps || []).length };
  for (const e of emps || []) counts[e.status] = (counts[e.status] || 0) + 1;
  const list = sortEmployees(emps || []).filter((e) =>
    (status === "All" || e.status === status) &&
    (!q || [e.name, e.emp_code, e.designation, e.location].join(" ").toLowerCase().includes(q)));

  return (
    <>
      <div className="pagehead">
        <div><h1>Employees</h1><div className="muted">Current and past employees with KYC, bank and salary details</div></div>
        <Link className="btn primary" href="/employees/new">Add employee</Link>
      </div>
      <form className="row" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ marginBottom: 0, border: 0 }}>
          {["Active", "Draft", "Inactive", "All"].map((s) => (
            <Link key={s} href={`/employees?status=${s}${q ? `&q=${q}` : ""}`} className={status === s ? "active" : ""}>
              {s === "Inactive" ? "Past" : s}{counts[s] != null ? ` (${counts[s]})` : ""}
            </Link>
          ))}
        </div>
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={searchParams.q} placeholder="Search name, code, site…" style={{ maxWidth: 260 }} />
      </form>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th>Emp #</th><th>Name</th><th>WhatsApp</th><th>Designation</th><th>Location</th><th>Joined</th><th>Left</th>
            <th className="num">Gross / month</th><th>ESI</th><th>PF</th><th>Status</th>
          </tr></thead>
          <tbody>
            {list.map((e) => {
              const s = structureForMonth((structs || []).filter((x: Structure) => x.employee_id === e.id), today) as Structure | undefined;
              const gross = s ? Number(s.basic) + Number(s.hra) + Number(s.medical) + Number(s.conveyance) + Number(s.mobile) + Number(s.site_allowance) + Number(s.supervisor_allowance) + Number(s.overtime) : null;
              return (
                <tr key={e.id}>
                  <td className="mono">{e.emp_code}</td>
                  <td>
                    <Link href={`/employees/${e.id}`}>{e.name}</Link>
                    {e.joining_letter_url && <a className="small" style={{ marginLeft: 8 }} href={e.joining_letter_url} target="_blank" rel="noopener noreferrer" title="Joining letter">Joining letter ↗</a>}
                  </td>
                  <td>{e.mobile && waNumber(e.mobile) ? (
                    <a href={`https://wa.me/${waNumber(e.mobile)}`} target="_blank" rel="noopener noreferrer" title={`Open WhatsApp chat with ${e.name}`}>{e.mobile}</a>
                  ) : <span className="muted">–</span>}</td>
                  <td>{e.designation}</td><td>{e.location}</td>
                  <td>{fmtDate(e.date_of_joining)}</td><td>{fmtDate(e.date_of_leaving)}</td>
                  <td className="num">{gross == null ? <span className="badge warn">No structure</span> : inr(gross)}</td>
                  <td>{s?.esi_applicable ? "Yes" : "–"}</td><td>{s?.pf_applicable ? "Yes" : "–"}</td>
                  <td><span className={`badge ${e.status === "Active" ? "ok" : e.status === "Draft" ? "warn" : ""}`}>{e.status === "Inactive" ? "Past" : e.status}</span></td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={11} className="muted">No employees.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
