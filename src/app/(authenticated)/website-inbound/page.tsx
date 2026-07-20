import { ModuleKey, WebsiteInboundStatus, type Prisma } from "@prisma/client";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { updateWebsiteInboundStatusAction } from "@/modules/website-inbound/actions";
import { getWebsiteInboundShell } from "@/modules/website-inbound/queries";
import type {
  WebsiteInboundStatusFilter,
  WebsiteInboundTypeFilter
} from "@/modules/website-inbound/types";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WebsiteInboundPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_INBOUND);
  const params = searchParams ? await searchParams : {};
  const status = parseStatus(readParam(params.status));
  const formType = readParam(params.formType) ?? "ALL";
  const search = readParam(params.search) ?? "";
  const shell = await getWebsiteInboundShell(context, {
    status,
    formType,
    search
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Website Inbound"
        title="Website form submissions"
        description="Review website assessment requests, playbook downloads, and contact submissions captured from Newl's public website. Account setup submissions route to Finance credit checks."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total submissions" value={shell.metrics.totalCount} caption="All website forms" />
        <MetricCard label="New submissions" value={shell.metrics.newCount} caption="Needs first review" />
        <MetricCard label="Visible now" value={shell.metrics.visibleCount} caption="Current filtered view" />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filters</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Narrow by status, form source, or customer/contact text.
            </p>
          </div>
          <Link
            href="/website-inbound"
            className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Clear filters
          </Link>
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-[1fr,1fr,1.4fr,auto]">
          <label className="text-sm font-medium text-foreground">
            Status
            <select
              name="status"
              defaultValue={status}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="ALL">All statuses</option>
              {Object.values(WebsiteInboundStatus).map((value) => (
                <option key={value} value={value}>
                  {formatStatus(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-foreground">
            Form type
            <select
              name="formType"
              defaultValue={formType}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="ALL">All form types</option>
              {shell.formTypes.map((entry) => (
                <option key={entry.formType} value={entry.formType}>
                  {formatFormType(entry.formType)} ({entry.count})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-foreground">
            Search
            <input
              name="search"
              defaultValue={search}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Company, name, email, need, source"
            />
          </label>
          <div className="flex items-end">
            <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Apply
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Submission queue</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Showing the latest 200 submissions that match the current filters.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {shell.statusCounts.map((entry) => (
              <span
                key={entry.status}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground"
              >
                {formatStatus(entry.status)}: {entry.count}
              </span>
            ))}
          </div>
        </div>

        <div className="divide-y divide-border">
          {shell.submissions.length === 0 ? (
            <div className="p-5 text-sm text-mutedForeground">
              No website inbound submissions match this view.
            </div>
          ) : null}

          {shell.submissions.map((submission) => (
            <article key={submission.id} className="grid gap-5 p-5 xl:grid-cols-[0.8fr,1.2fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusBadgeClassName(submission.status)}>
                    {formatStatus(submission.status)}
                  </span>
                  <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                    {formatFormType(submission.formType)}
                  </span>
                </div>

                <h3 className="mt-3 text-lg font-semibold text-foreground">
                  {submission.company || submission.name || "Unassigned company"}
                </h3>
                <p className="mt-1 text-sm text-mutedForeground">
                  {formatDate(submission.createdAt)}
                </p>

                <dl className="mt-4 grid gap-2 text-sm">
                  <SummaryRow label="Name" value={submission.name} />
                  <SummaryRow label="Email" value={submission.email} />
                  <SummaryRow label="Phone" value={submission.phone} />
                  <SummaryRow label="Primary need" value={submission.primaryNeed} />
                  <SummaryRow label="Source" value={submission.source} />
                </dl>

                <form action={updateWebsiteInboundStatusAction} className="mt-4 flex gap-2">
                  <input type="hidden" name="submissionId" value={submission.id} />
                  <select
                    name="status"
                    defaultValue={submission.status}
                    className="min-h-10 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    {Object.values(WebsiteInboundStatus).map((value) => (
                      <option key={value} value={value}>
                        {formatStatus(value)}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                    Save
                  </button>
                </form>
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <p className="break-all text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                  {submission.pageUrl ?? "No page URL captured"}
                </p>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  {Object.entries(toFieldRecord(submission.fields)).map(([key, value]) => (
                    <div key={key} className="rounded-md border border-border bg-background p-3">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
                        {key}
                      </dt>
                      <dd className="mt-1 text-sm leading-6 text-foreground">
                        {renderFieldValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) {
    return null;
  }

  return (
    <div className="grid gap-1 sm:grid-cols-[7rem,1fr]">
      <dt className="font-medium text-mutedForeground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): WebsiteInboundStatusFilter {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value in WebsiteInboundStatus ? (value as WebsiteInboundStatus) : "ALL";
}

function formatStatus(status: WebsiteInboundStatus | string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatFormType(formType: WebsiteInboundTypeFilter) {
  return formType
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function statusBadgeClassName(status: WebsiteInboundStatus) {
  const base = "rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (status === WebsiteInboundStatus.NEW) {
    return `${base} border-warning/25 bg-warning/10 text-warning`;
  }

  if (status === WebsiteInboundStatus.CONVERTED || status === WebsiteInboundStatus.QUALIFIED) {
    return `${base} border-success/25 bg-success/10 text-success`;
  }

  if (status === WebsiteInboundStatus.CLOSED) {
    return `${base} border-border bg-muted/40 text-mutedForeground`;
  }

  return `${base} border-accentBorder bg-accentSoft text-primary`;
}

function toFieldRecord(fields: Prisma.JsonValue) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }

  return fields as Record<string, Prisma.JsonValue>;
}

function renderFieldValue(value: Prisma.JsonValue) {
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }

  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
