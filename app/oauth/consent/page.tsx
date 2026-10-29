// Consent page for connecting an app (e.g. Claude) to Spans Payroll through Supabase's OAuth 2.1 server.
// Supabase sends the person here with ?authorization_id=…; they must be signed in (and past two-step login) first.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function decide(form: FormData) {
  "use server";
  const sb = supabaseServer();
  const id = String(form.get("authorization_id") || "");
  const { data: allowed } = await sb.from("app_users").select("email").limit(1);
  const approve = form.get("decision") === "approve" && !!allowed?.length;
  const { data, error } = approve
    ? await sb.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
    : await sb.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}&error=${encodeURIComponent(error?.message || "Couldn't complete the request")}`);
  redirect(data!.redirect_url);
}

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export default async function Consent({ searchParams }: { searchParams: { authorization_id?: string; error?: string } }) {
  const id = searchParams.authorization_id;
  const sb = supabaseServer();
  const [{ data: { user } }, { data: allowed }] = await Promise.all([sb.auth.getUser(), sb.from("app_users").select("email").limit(1)]);
  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="loginwrap"><div className="login" style={{ maxWidth: 440 }}>{children}</div></div>
  );
  if (!id) return <Card><h1>Nothing to approve</h1><p className="muted">This link is missing its request. Start the connection again from Claude.</p></Card>;

  const { data, error } = await sb.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <Card><h1>Request expired</h1><p className="muted">{error?.message || "This request is no longer valid."} Start the connection again from Claude.</p></Card>;
  if (!("authorization_id" in data)) redirect(data.redirect_url); // already approved earlier
  const loopback = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(data.redirect_uri);

  return (
    <Card>
      <h1 style={{ marginBottom: 6 }}>Connect {data.client.name || "an app"}?</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        <b>{data.client.name || "This app"}</b> wants to use Spans Payroll as <b>{user?.email}</b>.
      </p>
      {searchParams.error && <div className="notice bad">{searchParams.error}</div>}
      {!allowed?.length ? (
        <div className="notice bad">This login isn&apos;t on the Spans Payroll users list, so it can&apos;t be connected.</div>
      ) : (
        <>
          <p style={{ marginBottom: 6 }}>It will be able to, with your access:</p>
          <ul style={{ marginTop: 0, paddingLeft: 18 }}>
            <li>read employees, salaries and payroll months</li>
            <li>add and change employees, salary revisions, attendance, OT and bonus</li>
            <li>start, recalculate, finalize or reopen payroll months</li>
          </ul>
          <p className="muted small">
            Bank, Aadhaar and PAN numbers stay masked unless a full number is asked for, and every change and reveal is recorded in the
            audit log as “via connected app”. It can&apos;t change who signs in. You can remove access any time in Settings → Connected apps.
          </p>
          <p className="small" style={{ marginBottom: 14 }}>
            You&apos;ll be sent back to <span className="mono">{host(data.redirect_uri)}</span>.
            {loopback && <><br /><b style={{ color: "var(--warn)" }}>This goes to a program on this computer. Only approve if you just started the connection yourself.</b></>}
          </p>
        </>
      )}
      <form action={decide} className="row" style={{ gap: 10 }}>
        <input type="hidden" name="authorization_id" value={id} />
        {!!allowed?.length && <button className="btn primary" name="decision" value="approve">Allow</button>}
        <button className="btn" name="decision" value="deny">Cancel</button>
      </form>
    </Card>
  );
}
