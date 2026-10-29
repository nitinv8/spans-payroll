import { myDb, rupees, type MySlip } from "@/lib/my";
import { monthLabel } from "@/lib/payroll";
import SlipShare from "./SlipShare";

export default async function MyPayslips() {
  const { sb, me } = await myDb();
  if (!me) return null;
  const { data } = await sb.rpc("my_payslips");
  const slips = (data || []) as MySlip[];
  return (
    <>
      <h1 style={{ fontSize: 20, margin: "4px 2px 12px" }}>Payslips</h1>
      {!slips.length && <div className="staff-card"><p className="muted" style={{ margin: 0 }}>No payslips yet. They appear here after each month is finalized.</p></div>}
      {slips.map((s) => (
        <div className="staff-card" key={s.line_id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }}>{monthLabel(s.month)}</h2>
            <b style={{ fontSize: 18 }}>{rupees(s.net_pay)}</b>
          </div>
          <div className="muted small" style={{ margin: "2px 0 10px" }}>
            Gross {rupees(s.gross)} · {Number(s.days.worked)} worked{Number(s.days.lop) ? ` · ${Number(s.days.lop)} LOP` : ""}
          </div>
          <SlipShare lineId={s.line_id} month={s.month} name={me.name} />
        </div>
      ))}
    </>
  );
}
