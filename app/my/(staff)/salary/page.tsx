import BreakupTable from "@/components/BreakupTable";
import { myDb, rupees, todayIST, type MySlip } from "@/lib/my";
import { DEFAULT_FORMULAS, financialYear, monthLabel, thisMonthIST } from "@/lib/payroll";
import { formulasForMonth, previewMonth, salaryBreakup } from "@/lib/breakup";
import { structureValues, type Structure } from "@/lib/run-logic";
import { fmtDate } from "@/lib/data";

const n = (v: unknown) => Number(v) || 0;
const COMPONENTS = ["basic", "hra", "medical", "conveyance", "mobile", "site_allowance", "supervisor_allowance", "overtime"];

export default async function MySalary() {
  const { sb, me } = await myDb();
  if (!me) return null;
  const [{ data: sal }, { data: slipsData }] = await Promise.all([sb.rpc("my_salary"), sb.rpc("my_payslips")]);
  const revisions = ((sal?.revisions || []) as (Structure & Record<string, unknown>)[]);
  const sets = (sal?.formula_sets || []) as { effective_from: string; formulas: unknown }[];
  const cur = revisions.find((r) => r.effective_from <= todayIST()) || revisions[revisions.length - 1];
  const month = cur ? previewMonth(cur.effective_from, thisMonthIST()) : thisMonthIST();
  const b = cur ? salaryBreakup(formulasForMonth(sets, month, DEFAULT_FORMULAS), month,
    { location: me.location, designation: me.designation, date_of_joining: null, state: me.state }, structureValues(cur)) : null;

  // PF / ESI so far this financial year (finalized months)
  const fy = financialYear(thisMonthIST());
  const slips = ((slipsData || []) as MySlip[]).filter((s) => financialYear(s.month) === fy).reverse();
  const coPf = (s: MySlip) => (s.eps != null || s.epf_employer != null ? n(s.eps) + n(s.epf_employer) : n(s.pf_employer));
  const tot = slips.reduce((a, s) => ({ pf: a.pf + n(s.pf_employee), pfCo: a.pfCo + coPf(s), esi: a.esi + n(s.esi_employee), esiCo: a.esiCo + n(s.esi_employer) }),
    { pf: 0, pfCo: 0, esi: 0, esiCo: 0 });
  const hasEsi = slips.some((s) => n(s.esi_employee) > 0);

  return (
    <>
      <h1 style={{ fontSize: 20, margin: "4px 2px 12px" }}>My salary</h1>
      {!b ? <div className="staff-card"><p className="muted" style={{ margin: 0 }}>Your salary details will show here once HR adds them.</p></div> : (
        <div className="staff-card">
          <div className="muted small">For a full month with no leave without pay{cur ? `, from ${fmtDate(cur.effective_from)}` : ""}</div>
          <div style={{ display: "flex", gap: 16, margin: "8px 0 12px" }}>
            <div><div className="muted small">In-hand / month</div><div className="big">{rupees(b.net.monthly)}</div></div>
            <div><div className="muted small">CTC / year</div><div className="big" style={{ fontSize: 20, paddingTop: 5 }}>{rupees(b.ctc.annual)}</div></div>
          </div>
          <BreakupTable b={b} yearly={false} />
        </div>
      )}

      <div className="staff-card">
        <h2>PF &amp; ESI</h2>
        <div className="staff-row"><span className="k">UAN (PF)</span><span className="v mono">{me.uan || "Not yet"}</span></div>
        <div className="staff-row"><span className="k">ESIC number</span><span className="v mono">{me.esic_number || "Not applicable"}</span></div>
        <h3 style={{ marginTop: 12 }}>So far in {fy} ({slips.length} month{slips.length === 1 ? "" : "s"})</h3>
        <div className="staff-row"><span className="k">PF from your salary</span><span className="v">{rupees(tot.pf)}</span></div>
        <div className="staff-row"><span className="k">PF paid by Spans for you</span><span className="v">{rupees(tot.pfCo)}</span></div>
        {hasEsi && <>
          <div className="staff-row"><span className="k">ESI from your salary</span><span className="v">{rupees(tot.esi)}</span></div>
          <div className="staff-row"><span className="k">ESI paid by Spans</span><span className="v">{rupees(tot.esiCo)}</span></div>
        </>}
        {slips.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="small" style={{ cursor: "pointer" }}>Month by month</summary>
            {slips.map((s) => (
              <div className="staff-row" key={s.line_id}><span className="k">{monthLabel(s.month)}</span>
                <span className="v small">PF {rupees(s.pf_employee)} + {rupees(coPf(s))}{hasEsi ? ` · ESI ${rupees(s.esi_employee)}` : ""}</span></div>
            ))}
          </details>
        )}
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <a className="staff-btn" href="https://passbook.epfindia.gov.in/" target="_blank" rel="noopener noreferrer">EPFO passbook (check PF balance) ↗</a>
          <a className="staff-btn" href="https://www.esic.gov.in/" target="_blank" rel="noopener noreferrer">ESIC website (e-Pehchan card) ↗</a>
        </div>
      </div>

      {revisions.length > 1 && (
        <div className="staff-card">
          <h2>Salary history</h2>
          {revisions.map((r) => (
            <div className="staff-row" key={r.id}><span className="k">From {fmtDate(r.effective_from)}</span>
              <span className="v">{rupees(COMPONENTS.reduce((a, k) => a + n(r[k]), 0))} gross / month</span></div>
          ))}
        </div>
      )}
    </>
  );
}
