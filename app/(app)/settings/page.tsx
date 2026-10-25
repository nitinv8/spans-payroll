import Link from "next/link";
import { pageDb } from "@/lib/data";
import { saveCompany, addAppUser, removeAppUser } from "@/app/actions";
import PasswordForm from "@/components/PasswordForm";
import TwoStep from "@/components/TwoStep";
import ConfirmButton from "@/components/Confirm";

export default async function Settings() {
  const { sb, user } = await pageDb();
  const [{ data: c }, { data: users }] = await Promise.all([
    sb.from("company_settings").select("*").eq("id", 1).single(),
    sb.from("app_users").select("*").order("email"),
  ]);
  const o = (c?.orgzit || {}) as Record<string, any>;
  const F = ({ n, l, v }: { n: string; l: string; v: string }) => (
    <div><label htmlFor={n}>{l}</label><input id={n} name={n} defaultValue={v || ""} /></div>
  );
  return (
    <>
      <div className="pagehead"><div><h1>Settings</h1><div className="muted">Company details, Orgzit export, users. Rates and formulas are under <Link href="/settings/formulas">Formulas</Link>. See every change in the <Link href="/settings/audit">Audit log</Link>.</div></div></div>
      <form action={saveCompany}>
        <div className="panel">
          <h2>Company (salary slip header)</h2>
          <div className="fields">
            <F n="name" l="Company name" v={c?.name} />
            <div className="wide"><label htmlFor="address">Address</label><input id="address" name="address" defaultValue={c?.address || ""} /></div>
            <F n="pan" l="PAN" v={c?.pan} />
            <F n="cin" l="CIN" v={c?.cin} />
            <div className="wide"><label htmlFor="slip_notes">Notes printed on slip (one per line)</label>
              <textarea id="slip_notes" name="slip_notes" rows={3} defaultValue={c?.slip_notes || ""} style={{ fontFamily: "inherit" }} /></div>
          </div>
        </div>
        <div className="panel">
          <h2>Orgzit upload file</h2>
          <p className="muted small" style={{ marginTop: -4 }}>Values filled into every row of the Orgzit salary CSV. Vendor name/ID come from each employee.</p>
          <div className="fields">
            <F n="created_by" l="Created By" v={o.created_by} />
            <F n="created_by_id" l="<Created By>_id" v={o.created_by_id} />
            <F n="type_of_transaction" l="Type of Transaction" v={o.type_of_transaction} />
            <div className="wide"><F n="expense_by" l="Expense By" v={o.expense_by} /></div>
            <F n="expense_by_id" l="<Expense By>_id" v={o.expense_by_id} />
            <F n="type_of_expense" l="Type of Expense" v={o.type_of_expense} />
            <F n="gst_input" l="GST Input" v={o.gst_input} />
            <F n="orgzit_status" l="Status" v={o.status} />
            <div className="wide"><label htmlFor="fy_ids">Financial Year IDs (one per line: FY2026-27 = jkb0g662kp)</label>
              <textarea id="fy_ids" name="fy_ids" rows={3} defaultValue={Object.entries(o.fy_ids || {}).map(([k, v]) => `${k} = ${v}`).join("\n")} /></div>
          </div>
        </div>
        <button className="btn primary">Save settings</button>
      </form>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>Users who can sign in</h2>
          <p className="muted small" style={{ marginTop: -4 }}>
            Two steps for a new person: add their email here, then create their login in Supabase → Authentication → Users → “Add user”.
          </p>
          <table><tbody>
            {(users || []).map((u) => (
              <tr key={u.email}><td>{u.email}</td><td className="muted">{u.name}</td>
                <td>{u.email !== user?.email && <form action={removeAppUser}><input type="hidden" name="email" value={u.email} /><ConfirmButton className="btn sm danger" message={`Remove ${u.email} from the allowed list? They will lose access immediately.`}>Remove</ConfirmButton></form>}</td></tr>
            ))}
          </tbody></table>
          <form action={addAppUser} className="row" style={{ marginTop: 10, alignItems: "end" }}>
            <div><label htmlFor="u-email">Email</label><input id="u-email" name="email" type="email" required /></div>
            <div><label htmlFor="u-name">Name</label><input id="u-name" name="name" /></div>
            <button className="btn">Add</button>
          </form>
        </div>
        <div className="panel">
          <h2>Your password</h2>
          <PasswordForm />
          <h2 style={{ marginTop: 22 }}>Two-step login</h2>
          <TwoStep />
        </div>
      </div>
    </>
  );
}
