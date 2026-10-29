import Link from "next/link";
import { pageDb } from "@/lib/data";
import { saveSite, updateSite } from "@/app/actions";
import { mapsLink } from "@/lib/geo";
import UseMyLocation from "./UseMyLocation";

export default async function Sites() {
  const { sb } = await pageDb();
  const { data: sites } = await sb.from("sites").select("*").order("active", { ascending: false }).order("name");
  return (
    <>
      <div className="pagehead">
        <div><h1>Sites</h1>
          <div className="muted">Check-ins within a site&apos;s radius show as on site; others are flagged &quot;away from site&quot; (not blocked).</div></div>
        <Link className="btn" href="/attendance">Attendance</Link>
      </div>
      <div className="panel">
        <h2>Add a site</h2>
        <form action={saveSite} className="fields">
          <div><label htmlFor="name">Site name</label><input id="name" name="name" required placeholder="e.g. Britannia Rohtak ETP" /></div>
          <div className="wide"><label htmlFor="where">Google Maps link or coordinates</label>
            <input id="where" name="where" required placeholder="https://maps.app.goo.gl/…  or  28.8955, 76.6066" /></div>
          <div><label htmlFor="radius_m">Radius (metres)</label><input id="radius_m" name="radius_m" type="number" min={25} max={20000} defaultValue={300} /></div>
          <div className="wide row" style={{ alignItems: "center" }}><button className="btn primary">Add site</button><UseMyLocation target="where" /></div>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>In Google Maps: open the site, tap Share, and copy the link. A radius of 200–500 m suits most plants; phones indoors can be 50–100 m off.</p>
      </div>
      <div className="panel">
        <h2>Sites ({sites?.length || 0})</h2>
        {!sites?.length ? <p className="muted">No sites yet. Until you add one, every check-in is recorded without a site.</p> : (
          <table>
            <thead><tr><th>Site</th><th>Location</th><th className="num">Radius</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.name}</b></td>
                  <td><a href={mapsLink(s.lat, s.lng)!} target="_blank" rel="noopener noreferrer" className="mono">{s.lat.toFixed(5)}, {s.lng.toFixed(5)} ↗</a></td>
                  <td className="num">
                    <form action={updateSite} className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <input type="hidden" name="id" value={s.id} />
                      <input name="radius_m" type="number" min={25} max={20000} defaultValue={s.radius_m} style={{ width: 90 }} aria-label="Radius in metres" />
                      <button className="btn sm">Save</button>
                    </form>
                  </td>
                  <td>{s.active ? <span className="badge ok">in use</span> : <span className="badge">off</span>}</td>
                  <td>
                    <form action={updateSite}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={s.active ? "false" : "true"} />
                      <button className="btn sm">{s.active ? "Stop using" : "Use again"}</button></form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
