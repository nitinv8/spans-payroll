import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";

/** One Supabase client + one auth check per request, shared by the layout and the page. */
export const pageDb = cache(async () => {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
});

/** Whether the signed-in user is on the allowed list (cached per request). */
export const isAllowed = cache(async () => {
  const { sb } = await pageDb();
  const { data } = await sb.from("app_users").select("email").limit(1);
  return !!data?.length;
});

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso + (iso.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
