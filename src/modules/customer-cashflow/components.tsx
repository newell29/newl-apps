import Link from "next/link";
import type { CashflowPriority, CashflowRiskTier } from "@prisma/client";

export function CashflowTabs() {
  const links = [
    { href: "/finance/customer-cashflow", label: "Dashboard" },
    { href: "/finance/customer-cashflow/summary", label: "Customers" },
    { href: "/finance/customer-cashflow/files", label: "File Queue" },
    { href: "/finance/customer-cashflow/collections", label: "Collections" },
    { href: "/finance/customer-cashflow/settings", label: "Credit Settings" }
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

export function Money({ value }: { value: number }) {
  return <>{formatMoney(value)}</>;
}

export function Percent({ value }: { value: number }) {
  return <>{`${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}</>;
}

export function DateValue({ value }: { value?: Date | null }) {
  return <>{value ? value.toLocaleDateString("en-US") : "n/a"}</>;
}

export function PriorityPill({ value }: { value: CashflowPriority }) {
  const className = {
    CRITICAL: "border-danger/25 bg-danger/10 text-danger",
    HIGH: "border-warning/25 bg-warning/10 text-warning",
    MEDIUM: "border-primary/25 bg-primary/10 text-primary",
    LOW: "border-border bg-muted text-mutedForeground"
  }[value];

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{formatEnum(value)}</span>;
}

export function TierPill({ value }: { value: CashflowRiskTier | string }) {
  const className = {
    A: "border-success/25 bg-success/10 text-success",
    B: "border-warning/25 bg-warning/10 text-warning",
    C: "border-primary/25 bg-primary/10 text-primary",
    D: "border-danger/25 bg-danger/10 text-danger",
    REVIEW: "border-border bg-muted text-mutedForeground"
  }[value] ?? "border-border bg-muted text-mutedForeground";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{value}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-mutedForeground">{body}</p>
    </div>
  );
}

export function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

export function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
