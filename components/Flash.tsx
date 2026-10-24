"use client";
import { useSearchParams } from "next/navigation";

export default function Flash() {
  const sp = useSearchParams();
  const error = sp.get("error");
  const saved = sp.get("saved");
  const refreshed = sp.get("refreshed");
  if (error) return <div className="notice bad"><b>Couldn&apos;t do that:</b> {error}</div>;
  if (saved) return <div className="notice ok">Saved.</div>;
  if (refreshed) return <div className="notice ok">Re-calculated with the latest formulas, employee details and salary structures.</div>;
  return null;
}
