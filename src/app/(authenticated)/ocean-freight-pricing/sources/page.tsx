import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { getOceanFreightPricingShell } from "@/modules/ocean-freight-pricing/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null) {
  return date ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not processed";
}

export default async function OceanFreightSourcesPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.OCEAN_FREIGHT_PRICING);
  const shell = await getOceanFreightPricingShell(context, { status: "active" });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ocean Freight Pricing"
        title="Sources"
        description="Trace pricing source emails and attachments captured from future Microsoft Graph ingestion workflows."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Source emails</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[900px] divide-y divide-border text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-mutedForeground">
              <tr>
                <th className="px-3 py-3">Received</th>
                <th className="px-3 py-3">From</th>
                <th className="px-3 py-3">Subject</th>
                <th className="px-3 py-3">Rate detected</th>
                <th className="px-3 py-3">Processed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shell.sources.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-mutedForeground" colSpan={5}>
                    No source emails have been ingested yet.
                  </td>
                </tr>
              ) : (
                shell.sources.map((source) => (
                  <tr key={source.id} className="align-top hover:bg-muted/30">
                    <td className="px-3 py-3 text-mutedForeground">{formatDate(source.receivedAt)}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{source.fromName || source.fromAddress || "Unknown sender"}</div>
                      {source.fromAddress ? <div className="text-xs text-mutedForeground">{source.fromAddress}</div> : null}
                    </td>
                    <td className="max-w-[420px] px-3 py-3 text-foreground">{source.subject}</td>
                    <td className="px-3 py-3 text-mutedForeground">{source.rateDetected ? "Yes" : "No"}</td>
                    <td className="px-3 py-3 text-mutedForeground">{formatDate(source.processedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
