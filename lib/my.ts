// Staff app data: everything comes from the my_* database functions, which only return the signed-in employee's records.
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";

export type MyProfile = {
  id: string; emp_code: string; name: string; father_name: string | null; designation: string | null; location: string | null; state: string | null;
  status: string; date_of_joining: string | null; date_of_leaving: string | null; mobile: string | null; email: string | null;
  uan: string | null; esic_number: string | null; bank_name: string | null; ifsc: string | null; bank_last4: string | null;
  joining_letter_url: string | null; privacy_ack_at: string | null;
};
export type MySlip = {
  line_id: string; month: string; payment_date: string | null; gross: number; net_pay: number;
  days: { worked: number; offs: number; leaves: number; lop: number };
  pf_employee: number | null; pf_employer: number | null; eps: number | null; epf_employer: number | null; pf_wage: number | null;
  esi_employee: number | null; esi_employer: number | null;
};
export type MyDay = { day: string; in_at: string | null; out_at: string | null; in_on_site: boolean | null; out_on_site: boolean | null;
  in_site: string | null; out_site: string | null; hr_status: string | null; hr_note: string | null };

export const myDb = cache(async () => {
  const sb = supabaseServer();
  const { data } = await sb.rpc("my_profile");
  return { sb, me: (data as MyProfile | null) ?? null };
});

export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const timeIST = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "";
export const rupees = (n: number | null | undefined) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
