// Spans Payroll MCP server (Streamable HTTP, stateless). Connect it in Claude as a custom connector:
//   https://<your-app>/api/mcp   — sign-in happens on the app's own consent page.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CORS, originOf, unauthorized, userFromToken } from "@/lib/mcp/auth";
import { registerTools, SERVER_INSTRUCTIONS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const origin = originOf(req);
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized(origin, "Sign in to Spans Payroll to use this connector.");
  const who = await userFromToken(token);
  if (!who) return unauthorized(origin, "The sign-in has expired. Reconnect to continue.");
  const { data: allowed } = await who.sb.from("app_users").select("email").limit(1);
  if (!allowed?.length) {
    return new Response(JSON.stringify({ error: "insufficient_scope",
      error_description: "This login isn't allowed to use Spans Payroll (not on the users list, or two-step login wasn't completed when connecting)." }),
      { status: 403, headers: { "Content-Type": "application/json", ...CORS } });
  }
  const server = new McpServer({ name: "spans-payroll", title: "Spans Payroll", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, { sb: who.sb, email: who.user.email ?? "" }, origin);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
