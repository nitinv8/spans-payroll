import { pageDb } from "@/lib/data";
import { inr, monthLabel, thisMonthIST } from "@/lib/payroll";
import { sortEmployees, structureForMonth, type Structure } from "@/lib/run-logic";
import { saveOt, deleteOt } from "@/app/actions";
import OtForm from "./OtForm";
import ConfirmButton from "@/components/Confirm";

export default async function Incentives({ searchParams }: { searchParams: { month?: string } }) {
  const { sb } = await pageDb();
  const month = searchParams.month || thisMonthIST().slice(0, 7);
  const [{ data: rows }, { data: emps }, { data: structs }] = await Promise.all([
    sb.from("ot_incentives").select("*, employees(name)").order("month", { ascending: false }).order("created_at"),
    sb.from("employees").select("*").eq("status", "Active"),
    sb.from("salary_structures").select("*"),
  ]);
  const employees = sortEmployees(emps || []).map((e) => {
    const s = structureForMonth((structs || []).filter((x: Structure) => x.employee_id === e.id), `${month}-01`) as Structure | undefined;
    return { id: e.id, name: e.name, location: e.location, s: s ? { basic: +s.basic, hra: +s.hra, medical: +s.medical, mobile: +s.mobile, site_allowance: +s.site_allowance, supervisor_allowance: +s.supervisor_allowance } : null };
  });
  const byMonth: Record<string, any[]> = {};
  for (const r of rows || []) (byMonth[r.month] ||= []).push(r);
  return (
    <>
      <div className="pagehead"><div><h1>OT incentives</h1><div className="muted">Extra days and holiday incentives, by month</div></div></div>
      <OtForm employees={employees} month={month} action={saveOt} />
      {Object.entries(byMonth).map(([m, list]) => (
        <div className="panel" key={m}>
          <h2>{monthLabel(m)} <span className="muted small">· ₹{inr(list.reduce((a, r) => a + (Number(r.amount) || 0), 0))}</span></h2>
          <table>
            <thead><tr><th>Employee</th><th>Site</th><th className="num">Days</th><th className="num">Amount</th><th>Remarks</th><th></th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.employees?.name}</td><td>{r.site}</td><td className="num">{r.days}</td>
                  <td className="num">{r.amount == null ? <span className="badge warn">no amount</span> : inr(r.amount)}</td>
                  <td className="small">{r.remarks}</td>
                  <td><form action={deleteOt}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="month" value={m.slice(0, 7)} /><ConfirmButton className="btn sm danger" message="Delete this OT / incentive entry?">Delete</ConfirmButton></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
