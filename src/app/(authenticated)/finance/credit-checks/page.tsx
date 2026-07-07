import { CreditCheckStatus, ModuleKey, type Prisma } from "@prisma/client";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { updateCreditCheckAction } from "@/modules/credit-checks/actions";
import { getCreditCheckShell, type CreditCheckStatusFilter } from "@/modules/credit-checks/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CreditChecksPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  const params = searchParams ? await searchParams : {};
  const status = parseStatus(readParam(params.status));
  const search = readParam(params.search) ?? "";
  const shell = await getCreditCheckShell(context, { status, search });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Credit Checks"
        description="Review new account setup submissions, verify trade references, add finance notes, and assign customer credit limits before onboarding."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total credit checks" value={shell.metrics.totalCount} caption="Account setup forms" />
        <MetricCard label="New" value={shell.metrics.newCount} caption="Needs first review" />
        <MetricCard label="In review" value={shell.metrics.inReviewCount} caption="Finance follow-up" />
        <MetricCard label="Approved" value={shell.metrics.approvedCount} caption="Credit assigned" />
        <MetricCard label="Visible now" value={shell.metrics.visibleCount} caption="Current filter" />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filters</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Search by company, contact, or AP email. Account setup forms are routed here instead of Website Inbound.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {shell.statusCounts.map((entry) => (
              <span key={entry.status} className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
                {formatStatus(entry.status)}: {entry.count}
              </span>
            ))}
          </div>
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-[1fr,1.6fr,auto]">
          <label className="text-sm font-medium text-foreground">
            Status
            <select name="status" defaultValue={status} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              <option value="ALL">All statuses</option>
              {Object.values(CreditCheckStatus).map((value) => (
                <option key={value} value={value}>
                  {formatStatus(value)}
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
              placeholder="Company, contact, or email"
            />
          </label>
          <div className="flex items-end">
            <button className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Apply
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        {shell.creditChecks.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5 text-sm text-mutedForeground shadow-sm">
            No credit checks match this view.
          </div>
        ) : null}

        {shell.creditChecks.map((creditCheck) => (
          <details key={creditCheck.id} className="group rounded-lg border border-border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none flex-col gap-4 p-5 marker:hidden lg:grid lg:grid-cols-[1.3fr,0.9fr,0.8fr,auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusBadgeClassName(creditCheck.status)}>{formatStatus(creditCheck.status)}</span>
                  {creditCheck.referencesContacted ? (
                    <span className="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                      References contacted
                    </span>
                  ) : (
                    <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                      References pending
                    </span>
                  )}
                </div>
                <h2 className="mt-3 text-lg font-semibold text-foreground">
                  {creditCheck.company ?? "Unassigned company"}
                </h2>
                <p className="mt-1 text-sm text-mutedForeground">{formatDate(creditCheck.createdAt)}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium text-mutedForeground">Contact</p>
                <p className="mt-1 font-semibold text-foreground">{creditCheck.primaryContactName ?? "Not provided"}</p>
                <p className="mt-1 break-words text-mutedForeground">{creditCheck.primaryContactEmail ?? "No email captured"}</p>
              </div>

              <div className="text-sm">
                <p className="font-medium text-mutedForeground">Credit</p>
                <p className="mt-1 text-foreground">Requested: {creditCheck.requestedCreditLimit ?? "Not provided"}</p>
                <p className="mt-1 text-foreground">Approved: {creditCheck.approvedCreditLimit ?? "Not set"}</p>
              </div>

              <span className="inline-flex min-h-10 items-center justify-center rounded-md border border-border px-3 text-sm font-semibold text-foreground transition-colors group-open:bg-muted group-hover:bg-muted">
                <span className="group-open:hidden">Open</span>
                <span className="hidden group-open:inline">Close</span>
              </span>
            </summary>

            <div className="grid gap-5 border-t border-border p-5 xl:grid-cols-[0.9fr,1.1fr]">
              <div>
                {creditCheck.operatingName && creditCheck.operatingName !== creditCheck.company ? (
                  <p className="text-sm text-mutedForeground">Operating as {creditCheck.operatingName}</p>
                ) : null}

                <dl className="mt-4 grid gap-2 text-sm">
                  <SummaryRow label="Primary contact" value={creditCheck.primaryContactName} />
                  <SummaryRow label="Contact email" value={creditCheck.primaryContactEmail} />
                  <SummaryRow label="AP email" value={creditCheck.accountsPayableEmail} />
                  <SummaryRow label="Main phone" value={creditCheck.mainPhone} />
                  <SummaryRow label="Requested credit" value={creditCheck.requestedCreditLimit} />
                  <SummaryRow label="Approved credit" value={creditCheck.approvedCreditLimit} />
                  <SummaryRow label="Source page" value={creditCheck.pageUrl} />
                </dl>

                <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Services requested</p>
                  <p className="mt-1 text-sm leading-6 text-foreground">{renderFieldValue(creditCheck.services)}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-md border border-border bg-muted/30 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Submitted references and finance fields</p>
                  <dl className="mt-3 grid gap-3 md:grid-cols-2">
                    {Object.entries(toFieldRecord(creditCheck.tradeReferences)).map(([key, value]) => (
                      <FieldTile key={key} label={key} value={value} />
                    ))}
                    {Object.entries(toImportantFieldRecord(creditCheck.fields)).map(([key, value]) => (
                      <FieldTile key={key} label={key} value={value} />
                    ))}
                  </dl>
                </div>

                <form action={updateCreditCheckAction} className="rounded-md border border-border bg-background p-4">
                  <input type="hidden" name="creditCheckId" value={creditCheck.id} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-medium text-foreground">
                      Status
                      <select
                        name="status"
                        defaultValue={creditCheck.status}
                        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        {Object.values(CreditCheckStatus).map((value) => (
                          <option key={value} value={value}>
                            {formatStatus(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium text-foreground">
                      Approved credit amount
                      <input
                        name="approvedCreditLimit"
                        defaultValue={creditCheck.approvedCreditLimit ?? ""}
                        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="$10,000"
                      />
                    </label>
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <input
                      type="checkbox"
                      name="referencesContacted"
                      value="true"
                      defaultChecked={creditCheck.referencesContacted}
                      className="h-4 w-4 rounded border-border text-primary"
                    />
                    References have been contacted
                  </label>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-medium text-foreground">
                      Reference notes
                      <textarea
                        name="referenceNotes"
                        defaultValue={creditCheck.referenceNotes ?? ""}
                        className="mt-2 min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="Who was contacted, what was confirmed, and any concerns."
                      />
                    </label>
                    <label className="text-sm font-medium text-foreground">
                      Internal finance notes
                      <textarea
                        name="internalNotes"
                        defaultValue={creditCheck.internalNotes ?? ""}
                        className="mt-2 min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder="Credit decision, follow-up owner, or onboarding context."
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                      Save credit review
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) {
    return null;
  }

  return (
    <div className="grid gap-1 sm:grid-cols-[8rem,1fr]">
      <dt className="font-medium text-mutedForeground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

function FieldTile({ label, value }: { label: string; value: Prisma.JsonValue }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{formatFieldLabel(label)}</dt>
      <dd className="mt-1 text-sm leading-6 text-foreground">{renderFieldValue(value)}</dd>
    </div>
  );
}

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): CreditCheckStatusFilter {
  if (!value || value === "ALL") {
    return "ALL";
  }

  return value in CreditCheckStatus ? (value as CreditCheckStatus) : "ALL";
}

function formatStatus(status: CreditCheckStatus | string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatFieldLabel(label: string) {
  return label
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function statusBadgeClassName(status: CreditCheckStatus) {
  const base = "rounded-full border px-2.5 py-1 text-xs font-semibold";

  if (status === CreditCheckStatus.NEW) {
    return `${base} border-warning/25 bg-warning/10 text-warning`;
  }

  if (status === CreditCheckStatus.APPROVED) {
    return `${base} border-success/25 bg-success/10 text-success`;
  }

  if (status === CreditCheckStatus.DECLINED) {
    return `${base} border-danger/25 bg-danger/10 text-danger`;
  }

  return `${base} border-accentBorder bg-accentSoft text-primary`;
}

function toFieldRecord(fields: Prisma.JsonValue | null) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }

  return fields as Record<string, Prisma.JsonValue>;
}

function toImportantFieldRecord(fields: Prisma.JsonValue) {
  const record = toFieldRecord(fields);
  const wanted = ["billing", "payment", "currency", "po", "invoice", "authorized", "title"];

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => {
      const normalized = key.toLowerCase();
      return wanted.some((candidate) => normalized.includes(candidate));
    })
  );
}

function renderFieldValue(value: Prisma.JsonValue | null) {
  if (Array.isArray(value)) {
    return value.length ? value.map(String).join(", ") : "Not provided";
  }

  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
