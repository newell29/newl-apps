import {
  CustomerIdentityMatchKind,
  CustomerIdentityMatchStatus,
  CustomerLifecycle
} from "@prisma/client";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { ContactEditPanel } from "@/modules/customer-intelligence/components/contact-edit-panel";
import {
  requireMatchApproval,
  requireReadAccess,
  requireWrite
} from "@/modules/customer-intelligence/permissions";
import { getCompanyProfileDetail } from "@/modules/customer-intelligence/queries";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Canonical company profile (CP-PHASE-02B-4): leadership-only (ADMIN /
 * MANAGER / FINANCE) server-rendered detail page over existing tenant-scoped
 * foundation data. Unknown and cross-tenant company identifiers render as not
 * found; news and TradeMining sections stay honest configuration/empty states
 * and no external system is contacted.
 */
export default async function CustomerIntelligenceCompanyDetailPage({
  params
}: {
  params: Promise<{ companyId: string }>;
}) {
  const context = await getAuthenticatedContext();
  await requireReadAccess(context);

  const { companyId } = await params;
  const detail = await getCompanyProfileDetail(context, companyId);

  if (!detail) {
    notFound();
  }

  let canEditContacts = false;
  try {
    await requireMatchApproval(context);
    await requireWrite(context);
    canEditContacts = true;
  } catch {
    canEditContacts = false;
  }

  const totalApprovedMatches = detail.identityMatches.filter(
    (match) =>
      match.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT &&
      match.status === CustomerIdentityMatchStatus.APPROVED
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          eyebrow="Customer Intelligence"
          title={detail.company.name}
          description={`Canonical company profile assembled from tenant-scoped stored data${
            detail.company.primaryIndustry ? ` · ${detail.company.primaryIndustry}` : ""
          }.`}
        />
        <div className="flex items-center gap-2 pt-2">
          <LifecycleBadge lifecycle={detail.lifecycle} />
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-mutedForeground">
            {detail.relationships.length} operating compan
            {detail.relationships.length === 1 ? "y" : "ies"}
          </span>
        </div>
      </div>

      <OverviewSection detail={detail} totalApprovedMatches={totalApprovedMatches} />

      <SourceAccountsSection detail={detail} />

      <ContactsSection detail={detail} canEditContacts={canEditContacts} />

      <OpportunitiesSection detail={detail} />

      <NewsSection />

      <TradeMiningSection detail={detail} />
    </div>
  );
}

function OverviewSection({
  detail,
  totalApprovedMatches
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getCompanyProfileDetail>>>;
  totalApprovedMatches: number;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">Overview</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Canonical identity
          </p>
          <p className="mt-2 font-semibold text-foreground">{detail.company.name}</p>
          {detail.company.domain ? (
            <p className="mt-1 text-sm text-mutedForeground">{detail.company.domain}</p>
          ) : null}
          {detail.company.primaryIndustry ? (
            <p className="mt-1 text-sm text-mutedForeground">
              {detail.company.primaryIndustry}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-mutedForeground">
            {totalApprovedMatches} approved QuickBooks match
            {totalApprovedMatches === 1 ? "" : "es"} · {detail.sourceAccountCount} source
            account{detail.sourceAccountCount === 1 ? "" : "s"}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Operating-company relationships & lifecycle
          </p>
          <div className="mt-2 space-y-3">
            {detail.relationships.map((relationship) => (
              <div
                key={relationship.relationshipId}
                className="rounded-md border border-border bg-muted/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-foreground">
                    {relationship.operatingCompanyName}
                  </p>
                  <LifecycleBadge lifecycle={relationship.lifecycle} />
                </div>
                <p className="mt-1 text-xs text-mutedForeground">
                  {relationship.approvedMatchCount} approved match
                  {relationship.approvedMatchCount === 1 ? "" : "es"} ·{" "}
                  {relationship.sourceAccounts.length} source account
                  {relationship.sourceAccounts.length === 1 ? "" : "s"} · status{" "}
                  {relationship.status === "ACTIVE" ? "active" : "inactive"}
                </p>
                {relationship.notes ? (
                  <p className="mt-1 text-xs text-mutedForeground">{relationship.notes}</p>
                ) : null}
              </div>
            ))}
            {detail.relationships.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-sm text-mutedForeground">
                No operating-company relationship is stored for this company yet.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          Match status
        </p>
        {detail.identityMatches.length === 0 ? (
          <p className="mt-1 text-sm text-mutedForeground">
            No QuickBooks identity-match records are stored for this company.
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            {detail.identityMatches.map((match) => (
              <div
                key={match.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-mutedForeground">
                  {match.sourceLabel ?? match.sourceRecordKey ?? "Unnamed source record"}
                  {match.kind === CustomerIdentityMatchKind.QUICKBOOKS_ACCOUNT
                    ? " · QuickBooks"
                    : ""}
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {formatMatchStatus(match.status)} · score {match.score}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SourceAccountsSection({
  detail
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getCompanyProfileDetail>>>;
}) {
  const accounts = detail.relationships.flatMap((relationship) =>
    relationship.sourceAccounts.map((account) => ({
      ...account,
      operatingCompanyName: relationship.operatingCompanyName
    }))
  );

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">Source accounts</h2>
      {accounts.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-mutedForeground">
          No QuickBooks source accounts are stored for this company.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[760px] divide-y divide-border text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                {["Account", "Operating company", "Currency", "Status", "Last synced"].map(
                  (heading) => (
                    <th key={heading} className="px-3 py-2">{heading}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {account.displayName}
                    {account.email ? (
                      <p className="text-xs text-mutedForeground">{account.email}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-mutedForeground">
                    {account.operatingCompanyName}
                  </td>
                  <td className="px-3 py-2 text-mutedForeground">{account.currency}</td>
                  <td className="px-3 py-2 text-mutedForeground">
                    {account.active ? account.status.toLowerCase() : "inactive"}
                  </td>
                  <td className="px-3 py-2 text-mutedForeground">
                    {account.lastSyncedAt ? formatDate(account.lastSyncedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ContactsSection({
  detail,
  canEditContacts
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getCompanyProfileDetail>>>;
  canEditContacts: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Contacts</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            People connected to this canonical company, from stored tenant data.
          </p>
        </div>
        {canEditContacts ? (
          <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-mutedForeground">
            ADMIN / FINANCE can edit details
          </span>
        ) : null}
      </div>

      {detail.contacts.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-mutedForeground">
          No contacts are stored for this company.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {detail.contacts.map((contact) => (
            <div key={contact.id} className="rounded-md border border-border bg-muted/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{contact.fullName}</p>
                  {contact.title ? (
                    <p className="text-sm text-mutedForeground">{contact.title}</p>
                  ) : null}
                  {contact.department ? (
                    <p className="text-xs text-mutedForeground">{contact.department}</p>
                  ) : null}
                </div>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-semibold text-mutedForeground">
                  {formatContactStatus(contact.contactStatus)}
                </span>
              </div>
              {contact.email || contact.phone ? (
                <p className="mt-2 text-sm text-mutedForeground">
                  {contact.email ? (
                    <span className="mr-3">{contact.email}</span>
                  ) : null}
                  {contact.phone ? <span>{contact.phone}</span> : null}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-mutedForeground">
                {contact.evidenceCount} evidence
                {contact.evidenceCount === 1 ? " record" : " records"} ·{" "}
                {contact.contactPoints.length} contact point
                {contact.contactPoints.length === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-xs text-mutedForeground">
                Contact source: {formatStoredValue(contact.source)}
              </p>
              {contact.contactPoints.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-mutedForeground">
                  {contact.contactPoints.map((point) => (
                    <li key={point.id}>
                      <span className="font-medium text-foreground">
                        {formatPointType(point.type)}
                        {point.primary ? " (primary)" : ""}:
                      </span>{" "}
                      {point.displayValue ?? point.value} · Source:{" "}
                      {point.source ? formatStoredValue(point.source) : "Not stored"} · Verification:{" "}
                      {formatStoredValue(point.verificationStatus)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {canEditContacts ? (
                <div className="mt-3">
                  <ContactEditPanel
                    contactId={contact.id}
                    companyId={detail.company.id}
                    firstName={contact.firstName}
                    lastName={contact.lastName}
                    title={contact.title}
                    department={contact.department}
                    email={contact.email}
                    phone={contact.phone}
                    contactStatus={contact.contactStatus}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OpportunitiesSection({
  detail
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getCompanyProfileDetail>>>;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">Opportunities</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
        Existing sales-pipeline and stored opportunity-signal evidence only.
        Signals never create or advance an opportunity automatically.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-muted/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Sales pipeline
          </p>
          {detail.lead ? (
            <div className="mt-2">
              <p className="font-semibold text-foreground">
                {formatLeadStage(detail.lead.stage)}
              </p>
              <p className="mt-1 text-sm text-mutedForeground">
                Score {detail.lead.score}
                {detail.lead.ownerUserId ? ` · owner ${detail.lead.ownerUserId}` : ""}
              </p>
              {detail.lead.notes ? (
                <p className="mt-2 text-sm text-mutedForeground">{detail.lead.notes}</p>
              ) : null}
              <p className="mt-2 text-xs text-mutedForeground">
                Updated {formatDate(detail.lead.updatedAt)}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-mutedForeground">
              No stored sales-pipeline lead exists for this company.
            </p>
          )}
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
            Opportunity signals
          </p>
          {detail.opportunitySignals.length === 0 ? (
            <p className="mt-2 text-sm text-mutedForeground">
              No opportunity signals are stored for this company.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {detail.opportunitySignals.map((signal) => (
                <div
                  key={signal.id}
                  className="rounded-md border border-border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{signal.title}</p>
                    <span className="text-xs font-semibold text-mutedForeground">
                      {formatSignalType(signal.signalType)} · {signal.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-mutedForeground">
                    {signal.summary}
                  </p>
                  <p className="mt-1 text-xs text-mutedForeground">
                    {signal.serviceLine.toLowerCase()} · confidence {signal.confidence} ·{" "}
                    {formatDate(signal.observedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function NewsSection() {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">News</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
        Public-news collection is a later-phase capability and is not configured
        for Customer Intelligence in this phase. No news is fetched, displayed,
        or inferred from external sources; nothing here is fabricated.
      </p>
      <p className="mt-3 rounded-md border border-dashed border-border bg-background px-4 py-6 text-sm text-mutedForeground">
        No news source is connected. Reviewable news signals will appear here
        after the separately approved public-news collection phase.
      </p>
    </section>
  );
}

function TradeMiningSection({
  detail
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getCompanyProfileDetail>>>;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">TradeMining</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
        A separate per-company TradeMining search identity (primary search name,
        aliases, monitoring frequency, and human-confirmed match status) is not
        yet persisted: the current data model has no per-company TradeMining
        identity table, so no search name can be edited in this phase and no
        schema change was added. Editing the canonical company name never
        changes a TradeMining search identity.
      </p>
      <div className="mt-3 rounded-md border border-border bg-muted/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">
          Stored import-record evidence
        </p>
        {detail.importRecords.length === 0 ? (
          <p className="mt-2 text-sm text-mutedForeground">
            No TradeMining import records are stored for this company. Imports
            will be shown only from existing stored records; none are
            fabricated.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {detail.importRecords.map((record) => (
              <div
                key={record.id}
                className="rounded-md border border-border bg-background p-3 text-sm"
              >
                <p className="font-medium text-foreground">
                  {record.importerName ?? record.consigneeName ?? record.rawRecordKey}
                </p>
                <p className="mt-1 text-xs text-mutedForeground">
                  {[record.sourcePort, record.originCountry, record.productDescription]
                    .filter(Boolean)
                    .join(" · ") || "No origin detail stored"}
                  {record.arrivalDate ? ` · ${formatDate(record.arrivalDate)}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-3 rounded-md border border-dashed border-border bg-background px-4 py-4 text-sm text-mutedForeground">
        TradeMining search-name persistence, monitoring, and match confirmation
        require the separately approved TradeMining identity phase.
      </p>
    </section>
  );
}

function LifecycleBadge({ lifecycle }: { lifecycle: CustomerLifecycle }) {
  const label = lifecycle
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  const tone =
    lifecycle === CustomerLifecycle.ACTIVE_CUSTOMER
      ? "border-success/30 bg-success/10 text-foreground"
      : lifecycle === CustomerLifecycle.DORMANT_CUSTOMER
        ? "border-amber-500/30 bg-amber-500/10 text-foreground"
        : lifecycle === CustomerLifecycle.FORMER_CUSTOMER
          ? "border-danger/30 bg-danger/10 text-mutedForeground"
          : "border-primary/30 bg-primary/10 text-primary";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

function formatMatchStatus(status: CustomerIdentityMatchStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatContactStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatPointType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function formatStoredValue(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatLeadStage(stage: string): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatSignalType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
