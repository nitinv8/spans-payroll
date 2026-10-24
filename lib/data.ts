import { supabaseServer } from "@/lib/supabase/server";

export async function pageDb() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
