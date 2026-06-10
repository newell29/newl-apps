export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <p className="text-sm font-medium text-mutedForeground">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-primary">{value.toLocaleString("en-US")}</p>
    </div>
  );
}
