import { Suspense } from "react";
import Nav from "@/components/Nav";
import Flash from "@/components/Flash";
import { pageDb } from "@/lib/data";
import { signOut } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { sb, user } = await pageDb();
  const { data: allowed } = await sb.from("app_users").select("email").limit(1);
  const ok = !!allowed?.length;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Spans Payroll<span>Spans Envirotech</span></div>
        {ok && <Nav />}
        <div className="foot">
          <div>{user?.email}</div>
          <form action={signOut}><button className="btn sm">Sign out</button></form>
        </div>
      </aside>
      <main>
        <Suspense><Flash /></Suspense>
        {ok ? children : (
          <div className="panel">
            <h2>No access</h2>
            <p>You&apos;re signed in as <b>{user?.email}</b>, but this email isn&apos;t on the app&apos;s allowed list.
              Ask an existing user to add you under Settings → Users.</p>
          </div>
        )}
      </main>
    </div>
  );
}
