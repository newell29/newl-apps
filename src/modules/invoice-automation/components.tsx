import Link from "next/link";
import type { InvoiceAutomationStatus, InvoiceAutomationType } from "@prisma/client";

export function InvoiceAutomationTabs() {
  const links = [
    { href: "/finance/invoice-automation", label: "Operations Upload" },
    { href: "/finance/invoice-automation/accounting", label: "Accounting Queue" },
    { href: "/finance/invoice-automation/posted", label: "Posted" }
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

export function InvoiceTypePill({ value }: { value: InvoiceAutomationType | string }) {
  return (
    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
      {value === "CUSTOMER" ? "Customer" : "Vendor"}
    </span>
  );
}

export function InvoiceStatusPill({ value }: { value: InvoiceAutomationStatus | string }) {
  const className = {
    OPERATIONS_REVIEW: "border-primary/25 bg-primary/10 text-primary",
    ACCOUNTING_REVIEW: "border-warning/25 bg-warning/10 text-warning",
    APPROVED_FOR_POSTING: "border-success/25 bg-success/10 text-success",
    POSTED: "border-success/25 bg-success/10 text-success",
    POSTING_ERROR: "border-danger/25 bg-danger/10 text-danger",
    REJECTED: "border-border bg-muted text-mutedForeground"
  }[value] ?? "border-border bg-muted text-mutedForeground";

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{formatInvoiceEnum(value)}</span>;
}

export function formatInvoiceEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatInvoiceMoney(value: number | null, currency?: string | null) {
  if (value === null) {
    return "n/a";
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: currency || "CAD",
    maximumFractionDigits: 2
  });
}

