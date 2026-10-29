import { myDb } from "@/lib/my";
import { fmtDate } from "@/lib/data";

export default async function Me() {
  const { me } = await myDb();
  if (!me) return null;
  const rows: [string, string | null][] = [
    ["Employee #", me.emp_code], ["Designation", me.designation], ["Location", me.location], ["Date of joining", fmtDate(me.date_of_joining)],
    ...(me.date_of_leaving ? [["Last working day", fmtDate(me.date_of_leaving)] as [string, string]] : []),
    ["Father's name", me.father_name], ["Mobile", me.mobile], ["Email", me.email],
    ["Bank", [me.bank_name, me.bank_last4 ? `A/c ending ${me.bank_last4}` : null].filter(Boolean).join(" · ") || null], ["IFSC", me.ifsc],
    ["UAN (PF)", me.uan], ["ESIC number", me.esic_number],
  ];
  return (
    <>
      <h1 style={{ fontSize: 20, margin: "4px 2px 12px" }}>My details</h1>
      <div className="staff-card">
        {rows.map(([k, v]) => <div className="staff-row" key={k}><span className="k">{k}</span><span className="v">{v || "–"}</span></div>)}
      </div>
      {me.joining_letter_url && (
        <a className="staff-btn" style={{ width: "100%", marginBottom: 12 }} href={me.joining_letter_url} target="_blank" rel="noopener noreferrer">Joining letter ↗</a>
      )}
      <p className="muted small">If anything here is wrong (for example a new bank account or mobile number), please tell HR. For your security, details can only be changed by HR.</p>
    </>
  );
}
