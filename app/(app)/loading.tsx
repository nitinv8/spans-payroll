// Shown instantly while a page's data loads, so clicks feel immediate.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ width: 220, height: 26, marginBottom: 10 }} />
      <div className="skeleton" style={{ width: 340, height: 14, marginBottom: 24 }} />
      <div className="skeleton" style={{ height: 64, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  );
}
