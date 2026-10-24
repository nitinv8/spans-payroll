import EmployeeForm from "@/components/EmployeeForm";
import { pageDb } from "@/lib/data";

export default async function NewEmployee() {
  const { sb } = await pageDb();
  const { data } = await sb.from("employees").select("emp_code, location");
  const max = Math.max(0, ...(data || []).map((e) => Number((e.emp_code.match(/\d+/) || [0])[0])));
  const locations = Array.from(new Set((data || []).map((e) => e.location).filter(Boolean))) as string[];
  return (
    <>
      <div className="pagehead"><div><h1>Add employee</h1><div className="muted">Add the salary structure on the next screen</div></div></div>
      <EmployeeForm e={{ emp_code: `Emp ${max + 1}`, status: "Active", include_in_bank_file: true, sort_order: 100, bank_advice_email: "team@spans.co.in" }} locations={locations} />
    </>
  );
}
