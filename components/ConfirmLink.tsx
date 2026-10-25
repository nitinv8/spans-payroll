"use client";
// Download link that asks for confirmation first (used when a file was already generated or bank details changed).
export default function ConfirmLink({ href, message, className = "btn", children }: { href: string; message?: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} className={className} onClick={(e) => { if (message && !window.confirm(message)) e.preventDefault(); }}>{children}</a>
  );
}
