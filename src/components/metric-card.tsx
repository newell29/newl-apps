export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-ink">{value.toLocaleString("en-US")}</p>
    </div>
  );
}
