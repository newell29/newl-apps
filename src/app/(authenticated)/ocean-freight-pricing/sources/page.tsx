import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import {
  createOceanFreightRateCandidateFromSourceAction,
  markOceanFreightSourceNotAgentRateAction,
  saveOceanFreightMicrosoftGraphSettingsAction
} from "@/modules/ocean-freight-pricing/actions";
import { getOceanFreightSourcesShell, type OceanFreightSourceFilters } from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<OceanFreightSourceFilters>;

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not processed";
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function isSentFromConfiguredMailbox(source: { fromAddress: string | null; mailboxAddress: string }) {
  return source.fromAddress?.toLowerCase() === source.mailboxAddress.toLowerCase();
}

export default async function OceanFreightSourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const filters = await searchParams;
  const shell = await getOceanFreightSourcesShell(context, filters);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ocean Freight Pricing" title="Sources" description="Source emails ingested from tenant-configured Microsoft 365 mailbox targets." />
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Pricing mailbox ingestion</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Configure the mailboxes used only for Ocean Freight Pricing ingestion. Assistant chat memory uses separate Microsoft 365 settings.
            </p>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
            {shell.microsoftGraphSettings.mailSyncEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        <form action={saveOceanFreightMicrosoftGraphSettingsAction} className="mt-5 grid gap-4">
          <label className="grid gap-2 text-sm font-semibold text-foreground">
            Pricing mailbox targets
            <textarea
              className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal text-foreground"
              name="oceanMicrosoftMailboxTargets"
              defaultValue={shell.microsoftGraphSettings.adminMailboxTargets.join("\n")}
              placeholder="pricing@newlgroup.com"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Email history window
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                name="oceanMicrosoftMailLookbackDays"
                defaultValue={String(shell.microsoftGraphSettings.mailLookbackDays)}
              >
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
                <option value="180">Last 180 days</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Max emails per mailbox
              <input
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                name="oceanMicrosoftMaxMessagesPerMailbox"
                type="number"
                min="1"
                max="2000"
                defaultValue={shell.microsoftGraphSettings.maxMailMessagesPerMailbox}
              />
            </label>
            <label className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-semibold text-foreground">
              <input
                name="oceanMicrosoftMailSyncEnabled"
                value="true"
                type="checkbox"
                defaultChecked={shell.microsoftGraphSettings.mailSyncEnabled}
              />
              Enable pricing email ingestion
            </label>
          </div>

          <p className="text-sm leading-6 text-mutedForeground">{shell.microsoftGraphSettings.runtimeNotes}</p>
          <button className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground">
            Save pricing mailbox settings
          </button>
        </form>
      </section>

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-sm md:grid-cols-6">
        <input name="search" defaultValue={filters.search} placeholder="Search subject/body" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="sender" defaultValue={filters.sender} placeholder="Sender" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <select name="mailbox" defaultValue={filters.mailbox ?? ""} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">All mailboxes</option>
          {shell.mailboxes.map((mailbox) => <option key={mailbox} value={mailbox}>{mailbox}</option>)}
        </select>
        <input name="receivedFrom" type="date" defaultValue={filters.receivedFrom} className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <input name="receivedTo" type="date" defaultValue={filters.receivedTo} className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm text-mutedForeground"><input name="detectedOnly" value="true" type="checkbox" defaultChecked={filters.detectedOnly === "true"} /> Detected only</label>
        <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primaryForeground md:col-span-1">Apply filters</button>
        <a className="rounded-md border border-border px-3 py-2 text-center text-sm font-semibold text-foreground hover:bg-muted" href="/ocean-freight-pricing/review">Review queue</a>
      </form>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Source emails</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1500px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr><th className="px-3 py-3">Received</th><th className="px-3 py-3">Mailbox</th><th className="px-3 py-3">Sender</th><th className="px-3 py-3">Subject</th><th className="px-3 py-3">Agent rate?</th><th className="px-3 py-3">Review</th><th className="px-3 py-3">Attachments</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Preview</th><th className="px-3 py-3">Processed</th><th className="px-3 py-3">Link</th><th className="px-3 py-3">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shell.sources.length === 0 ? <tr><td className="px-3 py-8 text-center text-mutedForeground" colSpan={12}>No source emails match these filters.</td></tr> : shell.sources.map((source) => (
                <tr key={source.id} className="align-top hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{formatDate(source.receivedAt)}</td>
                  <td className="px-3 py-3 text-mutedForeground">{source.mailboxAddress}</td>
                  <td className="px-3 py-3"><div className="font-medium text-foreground">{source.fromName || source.fromAddress || "Unknown"}</div>{source.fromAddress ? <div className="text-xs text-mutedForeground">{source.fromAddress}</div> : null}</td>
                  <td className="max-w-[260px] px-3 py-3 text-foreground">{source.subject}</td>
                  <td className="px-3 py-3 font-medium">
                    {source.rateDetected ? (
                      <span className="rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">Likely inbound</span>
                    ) : isSentFromConfiguredMailbox(source) ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Outbound/RFQ</span>
                    ) : (
                      <span className="rounded-full border border-border bg-muted px-2 py-1 text-xs font-semibold text-mutedForeground">No</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-mutedForeground">
                    {source.candidates[0] ? (
                      <span className="rounded-full border border-border bg-muted px-2 py-1 text-xs font-semibold text-foreground">{source.candidates[0].status}</span>
                    ) : "Not queued"}
                  </td>
                  <td className="max-w-[300px] px-3 py-3 text-mutedForeground">
                    {source.attachments.length === 0 ? "None" : (
                      <details>
                        <summary className="cursor-pointer font-medium text-foreground">{source.attachments.length} attachment{source.attachments.length === 1 ? "" : "s"}</summary>
                        <ul className="mt-2 space-y-2">
                          {source.attachments.map((attachment) => (
                            <li key={attachment.id} className="rounded-md bg-muted/40 p-2">
                              <div className="truncate font-medium text-foreground" title={attachment.fileName}>{attachment.fileName}</div>
                              <div className="text-xs">{attachment.contentType || "Unknown type"} · {formatBytes(attachment.sizeBytes)}</div>
                              <div className="text-xs">{attachment.parseStatus || "NOT_PARSED"}{attachment.parseError ? ` · ${attachment.parseError}` : ""}</div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="max-w-[260px] px-3 py-3 text-mutedForeground">{source.detectionReason}</td>
                  <td className="max-w-[320px] px-3 py-3 text-mutedForeground">{source.bodyPreview || source.normalizedBodyText?.slice(0, 220) || "No preview"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{formatDate(source.processedAt)}</td>
                  <td className="px-3 py-3">{source.webLink ? <a href={source.webLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a> : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-[160px] flex-col gap-2">
                      {isSentFromConfiguredMailbox(source) ? (
                        <span className="text-xs text-mutedForeground">Sent from pricing mailbox</span>
                      ) : source.candidates[0] ? (
                        <a href="/ocean-freight-pricing/review" className="text-sm font-semibold text-primary hover:underline">Open review</a>
                      ) : (
                        <form action={createOceanFreightRateCandidateFromSourceAction}>
                          <input type="hidden" name="sourceEmailId" value={source.id} />
                          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primaryForeground">
                            Send to review
                          </button>
                        </form>
                      )}
                      {source.rateDetected ? (
                        <form action={markOceanFreightSourceNotAgentRateAction}>
                          <input type="hidden" name="sourceEmailId" value={source.id} />
                          <button className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">
                            Not agent rate
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
