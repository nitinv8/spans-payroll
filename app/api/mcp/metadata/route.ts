// OAuth protected resource metadata (RFC 9728) for the MCP endpoint; also served at /.well-known/oauth-protected-resource[/api/mcp].
import { AUTH_SERVER, CORS, originOf } from "@/lib/mcp/auth";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = originOf(req);
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [AUTH_SERVER],
    bearer_methods_supported: ["header"],
    resource_name: "Spans Payroll",
    resource_documentation: `${origin}/settings#connected-apps`,
  }, { headers: { "Cache-Control": "no-store", ...CORS } });
}
