import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Only same-site paths are allowed as a return address after sign-in. */
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : null);

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
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  // Two-step login: signed in with password only, but an authenticator app is set up → code still needed
  let needsCode = false;
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    needsCode = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  }
  const toLogin = () => {
    const url = request.nextUrl.clone();
    const back = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = back !== "/" ? `?next=${encodeURIComponent(back)}` : "";
    return NextResponse.redirect(url);
  };
  if (user && needsCode && !isLogin) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Two-step code needed" }, { status: 401 });
    return toLogin();
  }
  if (!user && !isLogin) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return toLogin();
  }
  if (user && isLogin && !needsCode) {
    const url = request.nextUrl.clone();
    url.pathname = safeNext(request.nextUrl.searchParams.get("next")) || "/";
    url.search = "";
    if (url.pathname.includes("?")) { const [p, q] = url.pathname.split("?"); url.pathname = p; url.search = `?${q}`; }
    return NextResponse.redirect(url);
  }
  return response;
}

// The MCP endpoint and its discovery document check their own (OAuth bearer) sign-in.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/mcp|\\.well-known/).*)"] };
