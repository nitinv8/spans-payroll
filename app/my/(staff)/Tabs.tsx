"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  today: <path d="M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />,
  att: <path d="M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4" />,
  slip: <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5M9 13h6M9 17h6" />,
  sal: <path d="M7 4h10M7 9h10M7 4c4 0 6 1.5 6 5s-2.5 5-6 5l7 6" />,
  me: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" />,
};
const TABS = [["/my", "Today", I.today], ["/my/attendance", "Attendance", I.att], ["/my/payslips", "Payslips", I.slip],
  ["/my/salary", "Salary", I.sal], ["/my/me", "Me", I.me]] as const;

export default function Tabs() {
  const p = usePathname();
  return (
    <nav className="staff-tabs" aria-label="Staff app">
      {TABS.map(([href, label, icon]) => {
        const on = href === "/my" ? p === "/my" : p.startsWith(href);
        return (
          <Link key={href} href={href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{icon}</svg>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
