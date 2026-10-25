"use client";
import { useMemo, useState } from "react";
import { suggestOtIncentive, daysInMonth } from "@/lib/payroll";

type Emp = { id: string; name: string; location: string | null; s: { basic: number; hra: number; medical: number; mobile: number; site_allowance: number; supervisor_allowance: number } | null };

export default function OtForm({ employees, month, action }: { employees: Emp[]; month: string; action: (f: FormData) => Promise<void> }) {
  const [emp, setEmp] = useState(employees[0]?.id || "");
  const [ym, setYm] = useState(month);
  const [days, setDays] = useState("1");
  const [extra, setExtra] = useState(false);
  const [esi, setEsi] = useState(false);
  const [amount, setAmount] = useState("");
  const e = employees.find((x) => x.id === emp);
  const sug = useMemo(() => (e?.s ? suggestOtIncentive(e.s, daysInMonth(`${ym}-01`), Number(days) || 0, extra, esi) : null), [e, ym, days, extra, esi]);

  return (
    <form action={action} className="panel">
      <h2>Add OT / holiday incentive</h2>
      <div className="fields">
        <div><label htmlFor="ot-month">Month</label><input id="ot-month" name="month" type="month" value={ym} onChange={(x) => setYm(x.target.value)} required /></div>
        <div><label htmlFor="ot-emp">Employee</label>
          <select id="ot-emp" name="employee_id" value={emp} onChange={(x) => setEmp(x.target.value)}>
            {employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></div>
        <div><label htmlFor="ot-site">Site</label><input id="ot-site" name="site" defaultValue={e?.location ?? ""} key={emp} /></div>
        <div><label htmlFor="ot-days">Extra days</label><input id="ot-days" name="days" type="number" step="0.5" value={days} onChange={(x) => setDays(x.target.value)} /></div>
        <div>
          <label htmlFor="ot-amt">Amount (₹)</label>
          <input id="ot-amt" name="amount" type="number" step="1" value={amount} placeholder={sug ? String(sug.amount) : ""} onChange={(x) => setAmount(x.target.value)} />
        </div>
        <div className="wide"><label htmlFor="ot-rem">Remarks</label><input id="ot-rem" name="remarks" placeholder="e.g. Independence Day & Rakhi" /></div>
      </div>
      <div className="row" style={{ margin: "12px 0", gap: 18 }}>
        <label className="check"><input type="checkbox" checked={extra} onChange={(x) => setExtra(x.target.checked)} /> 3+ days earns 1 extra day</label>
        <label className="check"><input type="checkbox" checked={esi} onChange={(x) => setEsi(x.target.checked)} /> Add 0.75% ESI</label>
        {sug && (
          <span className="muted small">
            Suggested: (salary excl. conveyance ÷ {daysInMonth(`${ym}-01`)} days) × {sug.paidDays} = <b>₹{sug.amount}</b>{" "}
            <button type="button" className="btn sm" onClick={() => setAmount(String(sug.amount))}>Use</button>
          </span>
        )}
      </div>
      <button className="btn primary">Add</button>
      <p className="muted small" style={{ marginBottom: 0 }}>When you start a month&apos;s payroll, these amounts go into each person&apos;s Incentive. For a payroll that&apos;s already started, use “Pull OT incentives”.</p>
    </form>
  );
}
