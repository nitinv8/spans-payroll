import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Only same-site paths are allowed as a return address after sign-in. */
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : null);

// Two kinds of login:
//  • HR (allowed users)          → the payroll app; employee pages are not for them
//  • Employees (mobile + PIN)    → only the staff app under /my and /api/my
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const staffArea = path === "/my" || path.startsWith("/my/") || path.startsWith("/api/my/");
  const isStaffLogin = path === "/my/login";
  const isEmployee = user?.app_metadata?.kind === "employee";

  // Redirect while keeping any refreshed sign-in cookies
  const go = (pathname: string, search = "") => {
    const url = request.nextUrl.clone();
    url.pathname = pathname; url.search = search;
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  const back = () => { const b = path + request.nextUrl.search; return b !== "/" ? `?next=${encodeURIComponent(b)}` : ""; };

  // ── Staff app
  if (staffArea) {
    if (isStaffLogin) return user && isEmployee ? go("/my") : response;
    if (!user) return isApi ? NextResponse.json({ error: "Not signed in" }, { status: 401 }) : go("/my/login");
    if (!isEmployee) return isApi ? NextResponse.json({ error: "Staff app only" }, { status: 403 }) : go("/");
    return response;
  }
  if (isEmployee) return isApi ? NextResponse.json({ error: "Not allowed" }, { status: 403 }) : go("/my");

  // ── HR app
  const isLogin = path.startsWith("/login");
  // Two-step login: signed in with password only, but an authenticator app is set up → code still needed
  let needsCode = false;
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    needsCode = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  }
  if (user && needsCode && !isLogin) {
    if (isApi) return NextResponse.json({ error: "Two-step code needed" }, { status: 401 });
    return go("/login", back());
  }
  if (!user && !isLogin) {
    if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return go("/login", back());
  }
  if (user && isLogin && !needsCode) {
    const next = safeNext(request.nextUrl.searchParams.get("next")) || "/";
    const [p, q] = next.split("?");
    return go(p, q ? `?${q}` : "");
  }
  return response;
}

// The MCP endpoint and its discovery document check their own (OAuth bearer) sign-in.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|staff-icon.png|api/mcp|\\.well-known/).*)"] };
