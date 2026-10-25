"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "Dashboard"], ["/payroll", "Monthly payroll"], ["/employees", "Employees"], ["/incentives", "OT incentives"],
  ["/bonus", "Bonus"], ["/settings/formulas", "Formulas"], ["/settings/audit", "Audit log"], ["/settings", "Settings"],
] as const;

export default function Nav() {
  const path = usePathname();
  const active = (href: string) =>
    href === "/" ? path === "/" : href === "/settings" ? path === "/settings" : path.startsWith(href);
  return (
    <nav>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={active(href) ? "active" : ""}>{label}</Link>
      ))}
    </nav>
  );
}
