// Reads a latitude/longitude from what people paste: "28.89, 76.60", Google Maps links (@lat,lng · ?q=lat,lng · !3dlat!4dlng).
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text || "").trim();
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/];
  for (const p of pats) {
    const m = t.match(p);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

export const mapsLink = (lat: number | null, lng: number | null) => (lat == null || lng == null ? null : `https://www.google.com/maps?q=${lat},${lng}`);
