// Shared (server + browser) helpers for contact details.

/** Mobile number → WhatsApp wa.me format (Indian numbers get the 91 prefix). Empty string if unusable. */
export const waNumber = (m: string | null | undefined) => {
  const d = (m || "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d.length >= 8 ? d : "";
};

/** Masks an ID / account number to its last 4 characters, e.g. ••••1234. */
export const mask = (v: string | null | undefined) => {
  const s = (v || "").replace(/\s/g, "");
  return s ? `••••${s.slice(-4)}` : "";
};
