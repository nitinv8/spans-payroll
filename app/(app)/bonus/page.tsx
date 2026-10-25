import { pageDb, fmtDate } from "@/lib/data";
import { inr, financialYear } from "@/lib/payroll";
import { sortEmployees } from "@/lib/run-logic";
import { saveBonus, deleteBonus } from "@/app/actions";

export default async function Bonus() {
  const { sb } = await pageDb();
  const fy = financialYear(new Date().toISOString().slice(0, 10));
  // Accrued annual bonus from payroll (formula "bonus") for the FY, per employee
  const fyStart = `${fy.slice(2, 6)}-04-01`, fyEnd = `${Number(fy.slice(2, 6)) + 1}-03-31`;
  const [{ data: rows }, { data: emps }, { data: lines }] = await Promise.all([
    sb.from("bonus_payments").select("*, employees(name, location)").order("created_at", { ascending: false }),
    sb.from("employees").select("id, name, emp_code, sort_order, status"),
    sb.from("payroll_lines").select("employee_id, calc, payroll_runs!inner(month)").gte("payroll_runs.month", fyStart).lte("payroll_runs.month", fyEnd),
  ]);
  const accrued: Record<string, number> = {};
  for (const l of lines || []) accrued[l.employee_id] = (accrued[l.employee_id] || 0) + (Number((l.calc as any)?.bonus) || 0);
  const paid: Record<string, number> = {};
  for (const r of rows || []) if (r.fy === fy) paid[r.employee_id] = (paid[r.employee_id] || 0) + Number(r.amount);
  const people = sortEmployees(emps || []).filter((e) => accrued[e.id] || paid[e.id]);

  return (
    <>
      <div className="pagehead"><div><h1>Bonus</h1><div className="muted">Accrued from payroll vs paid out · {fy}</div></div></div>
      <div className="grid2">
        <div className="panel">
          <h2>{fy}: accrued vs paid</h2>
          <table>
            <thead><tr><th>Employee</th><th className="num">Accrued (payroll)</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {people.map((e) => (
                <tr key={e.id}><td>{e.name}</td><td className="num">{inr(accrued[e.id])}</td><td className="num">{inr(paid[e.id])}</td>
                  <td className="num"><b>{inr((accrued[e.id] || 0) - (paid[e.id] || 0))}</b></td></tr>
              ))}
              {!people.length && <tr><td colSpan={4} className="muted">Nothing yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <form action={saveBonus} className="panel">
          <h2>Record a bonus payment</h2>
          <div className="fields">
            <div><label htmlFor="b-fy">Financial year</label><input id="b-fy" name="fy" defaultValue={fy} /></div>
            <div><label htmlFor="b-p">Period</label><select id="b-p" name="period"><option>April to September</option><option>October to March</option><option>Full year</option></select></div>
            <div><label htmlFor="b-e">Employee</label><select id="b-e" name="employee_id">{sortEmployees(emps || []).filter((e) => e.status === "Active").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
            <div><label htmlFor="b-a">Amount</label><input id="b-a" name="amount" type="number" step="1" required /></div>
            <div><label htmlFor="b-d">Transferred on</label><input id="b-d" name="transferred_on" type="date" /></div>
            <div><label htmlFor="b-r">Remarks</label><input id="b-r" name="remarks" /></div>
          </div>
          <div style={{ marginTop: 12 }}><button className="btn primary">Save</button></div>
        </form>
      </div>
      <div className="panel">
        <h2>Payments</h2>
        <table>
          <thead><tr><th>FY</th><th>Period</th><th>Employee</th><th>Site</th><th className="num">Amount</th><th>Transferred on</th><th>Remarks</th><th></th></tr></thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}><td>{r.fy}</td><td>{r.period}</td><td>{r.employees?.name}</td><td>{r.employees?.location}</td>
                <td className="num">{inr(r.amount)}</td><td>{fmtDate(r.transferred_on)}</td><td className="small">{r.remarks}</td>
                <td><form action={deleteBonus}><input type="hidden" name="id" value={r.id} /><button className="btn sm danger">Delete</button></form></td></tr>
            ))}
            {!rows?.length && <tr><td colSpan={8} className="muted">No bonus payments recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
