import type { AgentKey, AgentRunStatus } from "@/modules/agent-operations/types";

const AVATAR_CLASSES: Record<AgentKey, string> = {
  nemo: "bg-blue-500",
  hunter: "bg-success",
  rivet: "bg-violet-600",
  "website-scout": "bg-orange-500",
  "teamship-reader": "bg-teal-600",
  "garland-intake": "bg-orange-600"
};

export function AgentAvatar({ agentKey, initials, size = "md" }: { agentKey: AgentKey; initials: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${AVATAR_CLASSES[agentKey]} ${
        size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs"
      }`}
    >
      {initials}
    </span>
  );
}
export function AgentStatusBadge({ value }: { value: AgentRunStatus | string }) {
  const tone =
    value === "SUCCESS" || value === "COMPLETE"
      ? "border-success/25 bg-success/10 text-success"
      : value === "FAILED" || value === "MISSED" || value === "NEEDS_ATTENTION"
        ? "border-danger/25 bg-danger/10 text-danger"
        : value === "SKIPPED" || value === "SCHEDULED" || value === "NEXT" || value === "OVERDUE"
          ? "border-warning/25 bg-warning/10 text-warning"
          : value === "RUNNING"
            ? "border-success/25 bg-success/10 text-success"
            : "border-border bg-muted text-mutedForeground";

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{formatStatus(value)}</span>;
}

export function MetricCard({ label, value, tone = "primary" }: { label: string; value: number | string; tone?: "primary" | "success" | "warning" | "danger" }) {
  const valueClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-primary";
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="h-1 bg-primary" />
      <div className="p-5 text-center">
        <p className={`text-3xl font-semibold ${valueClass}`}>{value}</p>
        <p className="mt-1 text-sm text-mutedForeground">{label}</p>
      </div>
    </div>
  );
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
