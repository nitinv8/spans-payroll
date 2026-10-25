"use client";
import { useSearchParams } from "next/navigation";

export default function Flash() {
  const sp = useSearchParams();
  const error = sp.get("error");
  const saved = sp.get("saved");
  const refreshed = sp.get("refreshed");
  const deleted = sp.get("deleted");
  if (error) return <div className="notice bad"><b>Couldn&apos;t do that:</b> {error}</div>;
  if (deleted) return <div className="notice ok">Employee deleted.</div>;
  if (saved) return <div className="notice ok">Saved.</div>;
  if (refreshed) return <div className="notice ok">Re-calculated. Days and amounts you entered were kept.</div>;
  return null;
}
