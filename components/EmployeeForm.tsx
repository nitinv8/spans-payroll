import { saveEmployee } from "@/app/actions";
import SensitiveField from "./SensitiveField";
import { mask } from "@/lib/contact";

type E = Record<string, any>;
const F = ({ name, label, e, type = "text", wide = false, list }: { name: string; label: string; e: E; type?: string; wide?: boolean; list?: string }) => (
  <div className={wide ? "wide" : ""}>
    <label htmlFor={name}>{label}</label>
    <input id={name} name={name} type={type} defaultValue={e[name] ?? ""} list={list} />
  </div>
);

export default function EmployeeForm({ e = {}, locations = [] }: { e?: E; locations?: string[] }) {
  return (
    <form action={saveEmployee}>
      {e.id && <input type="hidden" name="id" value={e.id} />}
      <datalist id="locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
      <div className="panel">
        <h2>Basic details</h2>
        <div className="fields">
          <F name="emp_code" label="Employee # *" e={e} />
          <F name="name" label="Name *" e={e} />
          <F name="father_name" label="Father's name" e={e} />
          <F name="designation" label="Title / position" e={e} />
          <F name="location" label="Location / site" e={e} list="locations" />
          <div>
            <label htmlFor="state">State (for PT / LWF / ESIC)</label>
            <select id="state" name="state" defaultValue={e.state ?? ""}>
              <option value="">Work out from location</option>
              <option>Haryana</option><option>Karnataka</option><option>Delhi</option>
              <option>Uttar Pradesh</option><option>Maharashtra</option><option>Tamil Nadu</option><option>Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="status">Employment status</label>
            <select id="status" name="status" defaultValue={e.status || "Active"}>
              <option value="Active">Active</option><option value="Draft">Draft (offer / interview – not paid)</option><option value="Inactive">Inactive (left)</option>
            </select>
          </div>
          <F name="dob" label="Date of birth" e={e} type="date" />
          <F name="date_of_joining" label="Date of joining" e={e} type="date" />
          <F name="date_of_leaving" label="Last date of employment" e={e} type="date" />
          <F name="mobile" label="Mobile" e={e} />
          <F name="email" label="Email" e={e} type="email" />
          <F name="sort_order" label="Order on payroll (lower = first)" e={e} type="number" />
          <div className="wide">
            <label htmlFor="joining_letter_url">Joining letter (Google Drive link)</label>
            <input id="joining_letter_url" name="joining_letter_url" type="url" placeholder="https://drive.google.com/…" defaultValue={e.joining_letter_url ?? ""} />
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Bank & statutory</h2>
        <div className="fields">
          <SensitiveField name="bank_account" label="Bank account number" employeeId={e.id} masked={mask(e.bank_account)} />
          <F name="ifsc" label="IFSC" e={e} />
          <F name="bank_name" label="Bank name" e={e} />
          <F name="bank_advice_email" label="Email on HDFC bank file" e={e} type="email" />
          <SensitiveField name="pan" label="PAN" employeeId={e.id} masked={mask(e.pan)} />
          <SensitiveField name="aadhaar" label="Aadhaar" employeeId={e.id} masked={mask(e.aadhaar)} />
          <F name="uan" label="UAN (PF)" e={e} />
          <F name="esic_number" label="ESIC number" e={e} />
          <F name="epf_kyc" label="EPF KYC" e={e} />
          <div style={{ alignSelf: "end" }}>
            <label className="check"><input type="checkbox" name="include_in_bank_file" defaultChecked={e.include_in_bank_file ?? true} /> Include in HDFC bulk file</label>
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Accounting (Orgzit)</h2>
        <div className="fields">
          <F name="orgzit_description" label="Orgzit vendor description" e={e} wide />
          <F name="orgzit_id" label="Orgzit record ID" e={e} />
        </div>
      </div>
      <div className="panel">
        <h2>Other</h2>
        <div className="fields">
          <F name="blood_group" label="Blood group" e={e} />
          <F name="tshirt_size" label="T-shirt size" e={e} />
          <F name="tshirt_status" label="T-shirt status" e={e} />
          <F name="shoe_size" label="Shoe size" e={e} />
          <F name="id_card" label="ID card issued" e={e} />
          <div className="wide"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} defaultValue={e.notes ?? ""} style={{ fontFamily: "inherit" }} /></div>
        </div>
      </div>
      <button className="btn primary">Save employee</button>
    </form>
  );
}
