import "./my.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Spans Staff", manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "Spans Staff" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#142b38" };

export default function StaffRoot({ children }: { children: React.ReactNode }) {
  return <div className="staff">{children}</div>;
}
