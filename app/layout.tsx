import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Spans Payroll",
  description: "Employee database and monthly payroll for Spans Envirotech",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
