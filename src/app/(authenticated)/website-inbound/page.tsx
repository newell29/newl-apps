import { randomUUID } from "node:crypto";
import { ModuleKey, type Prisma } from "@prisma/client";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import {
  NoteComposer,
  OpportunityEditor
} from "@/modules/website-inbound/components/opportunity-editor";
import {
  CHANNEL_LABELS,
  CLOSED_STATUSES,
  FOLLOW_UP_TIME_ZONE,
  inboundUrl,
  PAGE_SIZE,
  parseFilters,
  STATUS_LABELS,
  todayDate,
  VIEWS
} from "@/modules/website-inbound/opportunities";
import { getWebsiteInboundShell } from "@/modules/website-inbound/queries";
import { requireModule, resolveRoleCanMutate } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";
const controlClass = "mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const linkClass = "rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted";

export default async function WebsiteInboundPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_INBOUND);
  const params = searchParams ? await searchParams : {};
  const filters = parseFilters(params);
  const selected = typeof params.selected === "string" ? params.selected.slice(0, 100) : undefined;
  const creating = params.add === "1";
  const requestedActivityPage = Number(params.activityPage);
  const [shell, canMutate] = await Promise.all([
    getWebsiteInboundShell(
      context,
      filters,
      creating ? undefined : selected,
      Number.isSafeInteger(requestedActivityPage) && requestedActivityPage > 0
        ? requestedActivityPage
        : 1
    ),
    resolveRoleCanMutate(context.tenantId, context.role)
  ]);
  const today = todayDate();
  const detail = shell.detail;
  const ownerLabels = new Map(shell.owners.map((owner) => [owner.id, owner.label]));
  const currentFilters = { ...filters, page: shell.page };
  const baseUrl = inboundUrl(currentFilters);
  const showPanel = (creating && canMutate) || Boolean(detail);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          eyebrow="Website Inbound"
          title="Inbound opportunities"
          description="Keep website, phone, and email enquiries moving with an owner, notes, and a clear next step."
        />
        {canMutate ? (
          <Link
            href={inboundUrl(currentFilters, { add: "1" })}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover"
          >
            + Add opportunity
          </Link>
        ) : null}
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="New enquiries"
          value={shell.metrics.newCount}
          caption="Awaiting first review"
        />
        <MetricCard
          label="Open opportunities"
          value={shell.metrics.openCount}
          caption="Including nurture and reviewed leads"
        />
        <MetricCard
          label="Overdue follow-ups"
          value={shell.metrics.overdueCount}
          caption="Open opportunities due before today"
        />
      </section>
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <nav aria-label="Opportunity views" className="flex flex-wrap gap-2">
          {Object.entries(VIEWS).map(([key, label]) => (
            <Link
              key={key}
              aria-current={filters.view === key ? "page" : undefined}
              href={inboundUrl(currentFilters, { view: key, status: "ALL", owner: "", page: "1" })}
              className={`${linkClass} ${filters.view === key ? "border-primary bg-accentSoft text-primary" : ""}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form key={JSON.stringify(filters)} className="mt-4 space-y-3">
          <input type="hidden" name="view" value={filters.view} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-medium">
              Search
              <input
                name="search"
                defaultValue={filters.search}
                maxLength={200}
                placeholder="Company, contact, email, phone…"
                className={controlClass}
              />
            </label>
            <label className="text-sm font-medium">
              Status
              <select name="status" defaultValue={filters.status} className={controlClass}>
                <option value="ALL">Any status in this view</option>
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Contact channel
              <select name="channel" defaultValue={filters.channel} className={controlClass}>
                <option value="ALL">All channels</option>
                {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Owner
              <select name="owner" defaultValue={filters.owner} className={controlClass}>
                <option value="">All owners</option>
                <option value="UNASSIGNED">Unassigned</option>
                {shell.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-medium">
              Service / requirement
              <input
                name="service"
                defaultValue={filters.service}
                maxLength={200}
                placeholder="e.g. warehousing"
                className={controlClass}
              />
            </label>
            <label className="text-sm font-medium">
              Lead source
              <input
                name="source"
                defaultValue={filters.source}
                maxLength={200}
                placeholder="e.g. website, referral"
                className={controlClass}
              />
            </label>
            <label className="text-sm font-medium">
              Enquiry date from
              <input type="date" name="from" defaultValue={filters.from} className={controlClass} />
            </label>
            <label className="text-sm font-medium">
              Enquiry date to
              <input type="date" name="to" defaultValue={filters.to} className={controlClass} />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium">
              Form type
              <select name="formType" defaultValue={filters.formType} className={controlClass}>
                <option value="">All form types</option>
                {shell.formTypes.map((entry) => (
                  <option key={entry.formType} value={entry.formType}>
                    {entry.formType.replaceAll("_", " ")} ({entry._count._all})
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground hover:bg-primaryHover">
              Apply filters
            </button>
            <Link href="/website-inbound" className={linkClass}>
              Clear filters
            </Link>
          </div>
        </form>
      </section>
      {selected && !detail && !creating ? (
        <p role="alert" className="rounded-md border border-border p-4">
          This opportunity could not be found.
        </p>
      ) : null}
      <div
        className={`grid items-start gap-5 ${showPanel ? "2xl:grid-cols-[minmax(0,1fr),30rem]" : ""}`}
      >
        <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex flex-wrap justify-between gap-2 border-b border-border p-4">
            <h2 className="font-semibold">Opportunity queue</h2>
            <span className="text-sm text-mutedForeground">
              {shell.metrics.totalCount} matching opportunities
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-mutedForeground">
                <tr>
                  {[
                    "Company / contact",
                    "Service",
                    "Channel / source",
                    "Status",
                    "Owner",
                    "Next action / follow-up"
                  ].map((label) => (
                    <th key={label} className="px-4 py-3 font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shell.submissions.map((row) => {
                  const overdue =
                    row.followUpOn &&
                    dateOnly(row.followUpOn) < today &&
                    !CLOSED_STATUSES.includes(row.status);
                  return (
                    <tr
                      key={row.id}
                      className={detail?.id === row.id ? "bg-accentSoft/50" : "hover:bg-muted/20"}
                    >
                      <td className="min-w-48 px-4 py-4 align-top">
                        <Link
                          href={inboundUrl(currentFilters, { selected: row.id })}
                          className="font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          {row.company || row.name || row.email || row.phone || "Unnamed enquiry"}
                        </Link>
                        <p className="mt-1 text-mutedForeground">{row.name}</p>
                        <p className="break-all text-xs text-mutedForeground">
                          {row.email || row.phone}
                        </p>
                        <p className="mt-2 text-xs text-mutedForeground">
                          {dateOnly(row.receivedOn)}
                        </p>
                      </td>
                      <td className="min-w-36 max-w-64 px-4 py-4 align-top">
                        <p className="line-clamp-3 whitespace-pre-wrap">
                          {row.primaryNeed || "Not specified"}
                        </p>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <p>{CHANNEL_LABELS[row.contactChannel]}</p>
                        <p className="mt-1 text-xs text-mutedForeground">
                          {row.source || "Unknown source"}
                        </p>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className="inline-block whitespace-nowrap rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-semibold">
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top">
                        {row.ownerUserId ? (
                          ownerLabels.get(row.ownerUserId) || "Former member"
                        ) : (
                          <span className="text-warning">Unassigned</span>
                        )}
                      </td>
                      <td className="min-w-44 max-w-72 px-4 py-4 align-top">
                        <p className="line-clamp-3 whitespace-pre-wrap">
                          {row.nextAction || "No next action"}
                        </p>
                        <p
                          className={`mt-2 text-xs ${overdue ? "font-semibold text-danger" : "text-mutedForeground"}`}
                        >
                          {row.followUpOn
                            ? `${overdue ? "Overdue · " : ""}${dateOnly(row.followUpOn)}`
                            : "No follow-up date"}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!shell.submissions.length ? (
              <p className="p-8 text-center text-sm text-mutedForeground">
                No opportunities match these filters. Clear filters or add an opportunity.
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border p-4 text-sm">
            <span>
              Page {shell.page} of {shell.pageCount} · {PAGE_SIZE} per page
            </span>
            <div className="flex gap-2">
              {shell.page > 1 ? (
                <Link
                  className={linkClass}
                  href={inboundUrl(currentFilters, { page: String(shell.page - 1) })}
                >
                  Previous
                </Link>
              ) : null}
              {shell.page < shell.pageCount ? (
                <Link
                  className={linkClass}
                  href={inboundUrl(currentFilters, { page: String(shell.page + 1) })}
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </section>
        {showPanel ? (
          <aside
            aria-label={detail ? "Opportunity details" : "Add opportunity"}
            className="min-w-0 rounded-lg border border-border bg-card p-5 shadow-sm"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {detail ? "Opportunity details" : "Add opportunity"}
                </h2>
                <p className="mt-1 text-xs text-mutedForeground">
                  {detail?.entryMethod === "WEBSITE_FORM"
                    ? "Website enquiry · editable working details"
                    : "Phone, email, referral, or other enquiry"}
                </p>
              </div>
              <Link href={baseUrl} className="text-sm text-primary underline">
                Close
              </Link>
            </div>
            <OpportunityEditor
              key={detail?.id ?? "new"}
              opportunity={
                detail
                  ? {
                      ...detail,
                      receivedOn: dateOnly(detail.receivedOn),
                      followUpOn: detail.followUpOn ? dateOnly(detail.followUpOn) : null
                    }
                  : undefined
              }
              owners={shell.owners}
              canMutate={canMutate}
              today={today}
              creationKey={creating ? randomUUID() : undefined}
              returnTo={baseUrl}
              currentUserId={context.userId}
            />
            {detail ? (
              <>
                <section className="mt-6 space-y-4 border-t border-border pt-5">
                  <h3 className="font-semibold">Notes and activity</h3>
                  {canMutate ? <NoteComposer key={detail.id} submissionId={detail.id} /> : null}
                  <ol className="space-y-3">
                    {shell.activities.map((event) => (
                      <li
                        key={event.id}
                        className="rounded-md border border-border bg-muted/20 p-3"
                      >
                        <p className="text-xs text-mutedForeground">
                          {event.actorName} ·{" "}
                          {new Intl.DateTimeFormat("en-CA", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: FOLLOW_UP_TIME_ZONE
                          }).format(event.createdAt)}
                        </p>
                        <p className="mt-1 text-sm font-semibold">
                          {event.type === "NOTE"
                            ? "Note"
                            : event.type === "CREATED"
                              ? "Created"
                              : "Details updated"}
                        </p>
                        {event.body ? (
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                            {event.body}
                          </p>
                        ) : null}
                        {event.changes ? (
                          <ul className="mt-2 space-y-1 text-xs">
                            {Object.entries(record(event.changes)).map(([key, value]) => {
                              const change = record(value);
                              return (
                                <li key={key}>
                                  <span className="font-semibold">{fieldLabel(key)}:</span>{" "}
                                  {displayChange(key, change.before, ownerLabels)} →{" "}
                                  {displayChange(key, change.after, ownerLabels)}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {!shell.activities.length ? (
                    <p className="text-sm text-mutedForeground">
                      No notes yet. Add the first update to this enquiry.
                    </p>
                  ) : null}
                  {shell.activityPages > 1 ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span>
                        Activity {shell.activityPage} of {shell.activityPages}
                      </span>
                      {shell.activityPage > 1 ? (
                        <Link
                          className="text-primary underline"
                          href={inboundUrl(currentFilters, {
                            selected: detail.id,
                            activityPage: String(shell.activityPage - 1)
                          })}
                        >
                          Newer
                        </Link>
                      ) : null}
                      {shell.activityPage < shell.activityPages ? (
                        <Link
                          className="text-primary underline"
                          href={inboundUrl(currentFilters, {
                            selected: detail.id,
                            activityPage: String(shell.activityPage + 1)
                          })}
                        >
                          Older
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </section>
                {detail.entryMethod === "WEBSITE_FORM" ? (
                  <details className="mt-6 border-t border-border pt-4">
                    <summary className="cursor-pointer text-sm font-semibold">
                      Original website submission
                    </summary>
                    <p className="mt-3 break-all text-xs text-mutedForeground">
                      {detail.pageUrl || "No page URL captured"}
                    </p>
                    <dl className="mt-3 space-y-3">
                      {Object.entries(record(detail.fields)).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-xs font-semibold text-mutedForeground">{key}</dt>
                          <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                            {renderValue(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}
function record(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function renderValue(value: Prisma.JsonValue | undefined) {
  return value == null || value === ""
    ? "Not provided"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}
function fieldLabel(key: string) {
  return (
    (
      {
        primaryNeed: "Services / requirements",
        name: "Contact",
        ownerUserId: "Owner",
        receivedOn: "Enquiry date",
        followUpOn: "Follow-up date",
        nextAction: "Next action",
        closedReason: "Outcome reason",
        contactChannel: "Channel"
      } as Record<string, string>
    )[key] || key.charAt(0).toUpperCase() + key.slice(1)
  );
}
function displayChange(
  key: string,
  value: Prisma.JsonValue | undefined,
  owners: Map<string, string>
) {
  if (typeof value === "string") {
    if (key === "ownerUserId") return owners.get(value) || "Former member";
    if (key === "status") return STATUS_LABELS[value as keyof typeof STATUS_LABELS] || value;
    if (key === "contactChannel")
      return CHANNEL_LABELS[value as keyof typeof CHANNEL_LABELS] || value;
  }
  return renderValue(value);
}
