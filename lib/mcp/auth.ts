// OAuth for the MCP endpoint. Supabase Auth is the authorization server (OAuth 2.1 server feature); this app is the
// protected resource. Access tokens are ordinary Supabase JWTs for the user, so database rules apply as in the web app.
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const AUTH_SERVER = `${SUPABASE_URL}/auth/v1`;

/** Public origin of this deployment (works behind Vercel's proxy). */
export function originOf(req: Request) {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export const metadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/api/mcp`;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

export function unauthorized(origin: string, description: string) {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl(origin)}"`, ...CORS },
  });
}

/** Verifies the bearer token with Supabase Auth and returns a client that acts as that user. */
export async function userFromToken(token: string) {
  const sb = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  return { sb, user: data.user };
}
