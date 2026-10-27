// Salary break-up table (server component): monthly and yearly, optionally compared with the previous revision,
// with the formula behind each line.
import { friendlyLabel, type Breakup, type BreakupRow } from "@/lib/breakup";
import { inr } from "@/lib/payroll";

type Pair = { monthly: number; annual: number };

function merge(a: BreakupRow[], b: BreakupRow[] | undefined) {
  const out = [...a];
  for (const r of b || []) if (!out.some((x) => x.key === r.key)) out.push({ ...r, monthly: 0, annual: 0 });
  return out;
}

export default function BreakupTable({ b, prev, showHow = false }: { b: Breakup; prev?: Breakup | null; showHow?: boolean }) {
  if (b.error) return <p style={{ color: "var(--bad)" }}>{b.error}</p>;
  const cmp = !!prev && !prev.error;
  const prevOf = (key: string, list: BreakupRow[] | undefined) => list?.find((r) => r.key === key)?.monthly ?? 0;
  const cols = 3 + (cmp ? 2 : 0) + (showHow ? 1 : 0);

  const change = (now: number, before: number) => {
    const d = Math.round(now - before);
    if (!d) return <span className="muted">–</span>;
    return <span style={{ color: d > 0 ? "var(--ok)" : "var(--bad)" }}>{d > 0 ? "+" : "−"}{inr(Math.abs(d))}</span>;
  };
  const Row = ({ r, list }: { r: BreakupRow; list?: BreakupRow[] }) => (
    <tr>
      <td>{friendlyLabel(r)}</td>
      {cmp && <td className="num muted">{inr(prevOf(r.key, list))}</td>}
      <td className="num">{inr(r.monthly)}</td>
      {cmp && <td className="num small">{change(r.monthly, prevOf(r.key, list))}</td>}
      <td className="num muted">{inr(r.annual)}</td>
      {showHow && <td className="mono small muted" style={{ maxWidth: 420, whiteSpace: "normal" }}>{r.expr}</td>}
    </tr>
  );
  const Total = ({ label, p, before, strong }: { label: string; p: Pair; before?: Pair; strong?: boolean }) => (
    <tr style={strong ? { background: "var(--soft)" } : undefined}>
      <td><b>{label}</b></td>
      {cmp && <td className="num muted"><b>{inr(before?.monthly ?? 0)}</b></td>}
      <td className="num"><b>{inr(p.monthly)}</b></td>
      {cmp && <td className="num small"><b>{change(p.monthly, before?.monthly ?? 0)}</b></td>}
      <td className="num"><b>{inr(p.annual)}</b></td>
      {showHow && <td />}
    </tr>
  );
  const Head = ({ t }: { t: string }) => (
    <tr><td colSpan={cols} style={{ paddingTop: 14, fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", color: "var(--brand)", textTransform: "uppercase" }}>{t}</td></tr>
  );

  return (
    <div className="tablewrap">
      <table className="breakup">
        <thead><tr>
          <th></th>
          {cmp && <th className="num">Before / month</th>}
          <th className="num">{cmp ? "Now / month" : "Per month"}</th>
          {cmp && <th className="num">Change</th>}
          <th className="num">Per year</th>
          {showHow && <th>How it&apos;s worked out</th>}
        </tr></thead>
        <tbody>
          <Head t="Salary" />
          {merge(b.earnings, prev?.earnings).map((r) => <Row key={r.key} r={r} list={prev?.earnings} />)}
          <Total label="Gross salary" p={b.gross} before={prev?.gross} />
          {(b.deductions.length > 0 || (prev?.deductions.length ?? 0) > 0) && <>
            <Head t="Deducted from salary" />
            {merge(b.deductions, prev?.deductions).map((r) => <Row key={r.key} r={r} list={prev?.deductions} />)}
            <Total label="Total deductions" p={b.deductionsTotal} before={prev?.deductionsTotal} />
          </>}
          <Total label="In-hand salary" p={b.net} before={prev?.net} strong />
          {b.employer.length > 0 && <>
            <Head t="Paid by the company on top of salary" />
            {merge(b.employer, prev?.employer).map((r) => <Row key={r.key} r={r} list={prev?.employer} />)}
          </>}
          <Total label="Cost to company (CTC)" p={b.ctc} before={prev?.ctc} strong />
        </tbody>
      </table>
    </div>
  );
}
