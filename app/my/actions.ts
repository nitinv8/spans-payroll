"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { mobile10, pinPassword, staffEmail } from "@/lib/employee-auth";
import { OpError } from "@/lib/ops";

/** Employee sign-in with mobile number + PIN (5 wrong PINs → 15-minute wait). */
export async function employeeSignIn(mobile: string, pin: string): Promise<{ error?: string }> {
  const m = mobile10(mobile);
  if (!m) return { error: "Enter your 10-digit mobile number." };
  if (!/^\d{6}$/.test(pin)) return { error: "Enter your 6-digit PIN." };
  const sb = supabaseServer();
  const { data: allowed } = await sb.rpc("employee_login_allowed", { p_mobile: m });
  if (allowed === false) return { error: "Too many wrong PINs. Wait 15 minutes and try again, or ask HR to reset your PIN." };
  let password: string;
  try { password = pinPassword(m, pin); } catch (e) { return { error: e instanceof OpError ? e.message : "Sign-in isn't available right now." }; }
  const { data, error } = await sb.auth.signInWithPassword({ email: staffEmail(m), password });
  const ok = !error && data.user?.app_metadata?.kind === "employee";
  await sb.rpc("employee_login_record", { p_mobile: m, p_ok: ok });
  if (!ok) {
    if (data?.user) await sb.auth.signOut();
    if (error?.message.toLowerCase().includes("banned")) return { error: "Your app access is turned off. Please contact HR." };
    return { error: "Mobile number or PIN is wrong. Ask HR if you need a new PIN." };
  }
  return {};
}

export async function employeeSignOut() {
  await supabaseServer().auth.signOut();
  redirect("/my/login");
}

export async function acknowledgePrivacy() {
  await supabaseServer().rpc("my_ack_privacy");
  redirect("/my");
}
