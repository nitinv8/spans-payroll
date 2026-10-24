"use client";
// Submit button that asks for confirmation first.
export default function ConfirmButton({ children, message, className = "btn" }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
