import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
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

export default async function OceanFreightSourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const filters = await searchParams;
  const shell = await getOceanFreightSourcesShell(context, filters);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Ocean Freight Pricing" title="Sources" description="Source emails ingested from tenant-configured Microsoft 365 mailbox targets." />
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
      </form>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Source emails</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[1200px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr><th className="px-3 py-3">Received</th><th className="px-3 py-3">Mailbox</th><th className="px-3 py-3">Sender</th><th className="px-3 py-3">Subject</th><th className="px-3 py-3">Detected</th><th className="px-3 py-3">Attachments</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Preview</th><th className="px-3 py-3">Processed</th><th className="px-3 py-3">Link</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shell.sources.length === 0 ? <tr><td className="px-3 py-8 text-center text-mutedForeground" colSpan={10}>No source emails match these filters.</td></tr> : shell.sources.map((source) => (
                <tr key={source.id} className="align-top hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-3 text-mutedForeground">{formatDate(source.receivedAt)}</td>
                  <td className="px-3 py-3 text-mutedForeground">{source.mailboxAddress}</td>
                  <td className="px-3 py-3"><div className="font-medium text-foreground">{source.fromName || source.fromAddress || "Unknown"}</div>{source.fromAddress ? <div className="text-xs text-mutedForeground">{source.fromAddress}</div> : null}</td>
                  <td className="max-w-[260px] px-3 py-3 text-foreground">{source.subject}</td>
                  <td className="px-3 py-3 font-medium">{source.rateDetected ? "Yes" : "No"}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
