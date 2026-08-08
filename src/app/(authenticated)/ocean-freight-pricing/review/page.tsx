import { ModuleKey, OceanEquipmentType, OceanExtractionStatus, type OceanFreightAgent, type OceanFreightAgentContact } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import {
  approveOceanFreightRateCandidateAction,
  rejectOceanFreightRateCandidateAction
} from "@/modules/ocean-freight-pricing/actions";
import { OceanFreightSuggestInput } from "@/modules/ocean-freight-pricing/components/suggest-input";
import { OCEAN_EQUIPMENT_LABELS } from "@/modules/ocean-freight-pricing/constants";
import { getOceanFreightReviewShell, type OceanFreightReviewFilters } from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<OceanFreightReviewFilters>;
type AgentWithContacts = OceanFreightAgent & { contacts: OceanFreightAgentContact[] };

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not reviewed";
}

function formatDateInput(date: Date | null) {
  return date?.toISOString().slice(0, 10) ?? "";
}

function decimalInput(value: { toString(): string } | null) {
  return value?.toString() ?? "";
}

function sourcePreview(candidate: Awaited<ReturnType<typeof getOceanFreightReviewShell>>["candidates"][number]) {
  return candidate.sourceEmail?.bodyPreview || candidate.sourceEmail?.normalizedBodyText?.slice(0, 420) || candidate.notes || "No source preview available.";
}

export default async function OceanFreightReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const filters = await searchParams;
  const shell = await getOceanFreightReviewShell(context, filters);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ocean Freight Pricing"
        title="Review queue"
        description="Review high-confidence inbound agent rate candidates and exceptions before publishing approved rates to the schedule."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <AutomationCard label="Classifier" value={shell.automationSettings.classificationEnabled ? "Enabled" : "Off"} caption={shell.automationSettings.classificationModel} />
        <AutomationCard label="Review mode" value={shell.automationSettings.exceptionOnlyReview ? "Focused" : "All open"} caption={`High confidence >= ${shell.automationSettings.highConfidenceThreshold}%`} />
        <AutomationCard label="Autopost" value={shell.automationSettings.autoPostEnabled ? "Allowed" : "Off"} caption={`Minimum ${shell.automationSettings.autoPostMinimumConfidence}%`} />
        <AutomationCard label="Safety gates" value={shell.automationSettings.trustedAgentOnlyAutoPost ? "Trusted agents" : "Any agent"} caption={shell.automationSettings.requireValidityEndDate ? "Validity required" : "Open validity allowed"} />
      </section>

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm md:grid-cols-[1fr_260px_auto_auto]">
        <input name="search" defaultValue={filters.search ?? ""} placeholder="Search agent, source, lane, carrier, or notes" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <select name="status" defaultValue={filters.status ?? "workQueue"} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="workQueue">High confidence + exceptions</option>
          <option value="open">Open review</option>
          {Object.values(OceanExtractionStatus).map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">Apply filters</button>
        <a href="/ocean-freight-pricing/sources" className="rounded-md border border-border px-4 py-2 text-center text-sm font-semibold text-foreground hover:bg-muted">Sources</a>
      </form>

      <section className="space-y-4">
        {shell.candidates.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-mutedForeground">
            No rate candidates match the current filters. Send an inbound agent source email to review from Sources.
          </div>
        ) : (
          shell.candidates.map((candidate) => (
            <article key={candidate.id} className="rounded-lg border border-border bg-card shadow-sm">
              <div className="grid gap-4 border-b border-border p-5 xl:grid-cols-[minmax(280px,0.9fr)_minmax(520px,1.5fr)]">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border bg-muted px-2 py-1 text-xs font-semibold text-foreground">{candidate.status}</span>
                    <span className="rounded-full border border-border px-2 py-1 text-xs font-semibold text-mutedForeground">{candidate.confidence}% confidence</span>
                    {candidate.reviewDisposition.isHighConfidence ? (
                      <span className="rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">High confidence</span>
                    ) : null}
                    {candidate.reviewDisposition.isException ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Exception</span>
                    ) : null}
                    {candidate.reviewDisposition.isAutoPostEligible ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">Autopost eligible</span>
                    ) : null}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{candidate.agentCompanyNameRaw || candidate.agent?.name || "Unknown agent"}</h2>
                    <p className="mt-1 text-sm text-mutedForeground">{candidate.agentContactEmailRaw || candidate.sourceEmail?.fromAddress || "No sender email"}</p>
                  </div>
                  {candidate.sourceEmail ? (
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <p className="font-semibold text-foreground">{candidate.sourceEmail.subject}</p>
                      <p className="mt-1 text-mutedForeground">From {candidate.sourceEmail.fromName || candidate.sourceEmail.fromAddress || "unknown"} on {formatDate(candidate.sourceEmail.receivedAt)}</p>
                      {candidate.sourceEmail.webLink ? <a className="mt-2 inline-flex text-sm font-semibold text-primary hover:underline" href={candidate.sourceEmail.webLink} target="_blank" rel="noreferrer">Open email</a> : null}
                    </div>
                  ) : null}
                  <p className="max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-6 text-mutedForeground">{sourcePreview(candidate)}</p>
                  {candidate.reviewDisposition.reasons.length > 0 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p className="font-semibold">Exception reasons</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {candidate.reviewDisposition.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <ReviewApprovalForm candidate={candidate} agents={shell.agents} />
              </div>

              {candidate.status === OceanExtractionStatus.APPROVED ? (
                <div className="px-5 py-3 text-sm text-mutedForeground">
                  Approved {formatDate(candidate.reviewedAt)}. Rate ID: {candidate.approvedRateId || "unknown"}.
                </div>
              ) : candidate.status === OceanExtractionStatus.REJECTED ? (
                <div className="px-5 py-3 text-sm text-mutedForeground">
                  Rejected {formatDate(candidate.reviewedAt)}: {candidate.rejectionReason || "No reason provided"}.
                </div>
              ) : (
                <form action={rejectOceanFreightRateCandidateAction} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <input name="rejectionReason" required placeholder="Rejection reason" className="min-w-80 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" />
                  <button className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Reject candidate</button>
                </form>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function AutomationCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm font-medium text-mutedForeground">{label}</p>
      <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-mutedForeground">{caption}</p>
    </div>
  );
}

function ReviewApprovalForm({
  candidate,
  agents
}: {
  candidate: Awaited<ReturnType<typeof getOceanFreightReviewShell>>["candidates"][number];
  agents: AgentWithContacts[];
}) {
  const isClosed = candidate.status === OceanExtractionStatus.APPROVED || candidate.status === OceanExtractionStatus.REJECTED;
  return (
    <form action={approveOceanFreightRateCandidateAction} className="grid gap-3">
      <input type="hidden" name="candidateId" value={candidate.id} />
      <div className="grid gap-3 md:grid-cols-2">
        <select name="agentId" defaultValue={candidate.agentId ?? ""} required disabled={isClosed} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">Select agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
        <select name="agentContactId" defaultValue={candidate.agentContactId ?? ""} disabled={isClosed} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">No contact</option>
          {agents.flatMap((agent) =>
            agent.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>{contact.fullName} - {agent.name}</option>
            ))
          )}
        </select>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <OceanFreightSuggestInput name="originPort" defaultValue={candidate.originPort ?? ""} suggestionField="ports" placeholder="Origin port" required disabled={isClosed} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
        <OceanFreightSuggestInput name="destinationPort" defaultValue={candidate.destinationPort ?? ""} suggestionField="ports" placeholder="Destination port" required disabled={isClosed} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
        <OceanFreightSuggestInput name="originCountry" defaultValue={candidate.originCountry ?? ""} suggestionField="countries" placeholder="Origin country" disabled={isClosed} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
        <OceanFreightSuggestInput name="destinationCountry" defaultValue={candidate.destinationCountry ?? ""} suggestionField="countries" placeholder="Destination country" disabled={isClosed} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <select name="equipmentType" defaultValue={candidate.equipmentType ?? OceanEquipmentType.FORTY_HQ} required disabled={isClosed} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
          {Object.values(OceanEquipmentType).map((type) => (
            <option key={type} value={type}>{OCEAN_EQUIPMENT_LABELS[type]}</option>
          ))}
        </select>
        <input name="equipmentLabel" defaultValue={candidate.equipmentLabelRaw ?? ""} disabled={isClosed} placeholder="Equipment label" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="shippingLine" defaultValue={candidate.shippingLine ?? ""} disabled={isClosed} placeholder="Carrier / shipping line" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <input name="rateAmount" defaultValue={decimalInput(candidate.rateAmount)} type="number" step="0.01" required disabled={isClosed} placeholder="Rate" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="currency" defaultValue={candidate.currency ?? "USD"} required disabled={isClosed} placeholder="Currency" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="transitTimeDays" defaultValue={candidate.transitTimeDays ?? ""} type="number" min="0" disabled={isClosed} placeholder="Transit days" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <input name="validityStartDate" defaultValue={formatDateInput(candidate.validityStartDate)} type="date" disabled={isClosed} className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="validityEndDate" defaultValue={formatDateInput(candidate.validityEndDate)} type="date" disabled={isClosed} className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </div>
      <textarea name="scheduleNotes" defaultValue={candidate.scheduleNotes ?? ""} disabled={isClosed} placeholder="Schedule notes" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <textarea name="freeTimeNotes" defaultValue={candidate.freeTimeNotes ?? ""} disabled={isClosed} placeholder="Free time notes" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <textarea name="detentionDemurrageNotes" defaultValue={candidate.detentionDemurrageNotes ?? ""} disabled={isClosed} placeholder="Detention/demurrage notes" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <textarea name="notes" defaultValue={candidate.notes ?? ""} disabled={isClosed} placeholder="Internal notes" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <input name="correctionNotes" disabled={isClosed} placeholder="Approval/correction notes" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
      <button disabled={isClosed} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground disabled:cursor-not-allowed disabled:opacity-60">
        Approve into rates
      </button>
    </form>
  );
}
