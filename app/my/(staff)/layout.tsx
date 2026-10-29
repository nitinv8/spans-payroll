import Tabs from "./Tabs";
import { myDb } from "@/lib/my";
import { acknowledgePrivacy, employeeSignOut } from "../actions";

export const dynamic = "force-dynamic";

const SignOut = () => (
  <form action={employeeSignOut} style={{ textAlign: "center", marginTop: 18 }}>
    <button className="staff-btn" style={{ border: 0, background: "none", color: "var(--muted)", minHeight: 0 }}>Sign out</button>
  </form>
);

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { me } = await myDb();
  if (!me) {
    return (
      <div className="staff-main">
        <div className="staff-card">
          <h2>App access is off</h2>
          <p style={{ margin: 0 }}>Your access to the staff app has been turned off or has ended. Please contact HR.</p>
        </div>
        <SignOut />
      </div>
    );
  }
  return (
    <>
      <header className="staff-top">
        <div className="co">Spans Envirotech · Staff</div>
        <div className="who">{me.name}</div>
        <div className="role">{[me.emp_code, me.designation].filter(Boolean).join(" · ")}</div>
      </header>
      <div className="staff-main">
        {!me.privacy_ack_at ? (
          <form action={acknowledgePrivacy} className="staff-card">
            <h2>Before you start</h2>
            <p>This app lets you mark attendance and see your payslips, salary and PF/ESI.</p>
            <p><b>When you check in or out</b>, the app takes a selfie and your phone&apos;s location at that moment only. It does not track you at any
              other time. Spans uses these only to confirm attendance. Selfies are deleted after 90 days.</p>
            <p>Your salary details are visible only to you and HR. If anything looks wrong, tell HR.</p>
            <button className="staff-btn primary" style={{ width: "100%" }}>I understand, continue</button>
          </form>
        ) : children}
        <SignOut />
      </div>
      <Tabs />
    </>
  );
}
