import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { GarlandTeamshipReviewClient } from "@/modules/shipment-documents/components/garland-teamship-review-client";
import { GarlandToolTabs } from "@/modules/shipment-documents/components/garland-tool-tabs";
import { requireModule } from "@/server/auth/authorization";
import { getTeamshipConfigurationStatus } from "@/server/integrations/teamship";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function GarlandTeamshipReviewPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  const teamshipStatus = await getTeamshipConfigurationStatus(context.tenantId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Garland Tools"
        title="Teamship order review"
        description="Upload Garland's daily shipping-order PDF, pull matching Teamship WMS orders by SR/shipment ID, and highlight field-level discrepancies before CSR review."
      />

      <GarlandToolTabs active="teamship-review" />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
          <div>
            <h2 className="text-base font-semibold text-foreground">Stage 1 workflow</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              The app reads Garland PS/SR shipping orders from the uploaded PDF, fetches matching Teamship shipping
              order details read-only, and marks each order green when the reviewed fields match or red when a CSR
              should inspect a discrepancy.
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Teamship API status</p>
            <p className="mt-2 text-sm text-foreground">
              {teamshipStatus.configured
                ? `Configured from ${teamshipStatus.source === "settings" ? "app settings" : "runtime environment"}. Manual pulls and PDF reviews can fetch Teamship orders read-only.`
                : `Not configured. Add ${teamshipStatus.missing.join(" and ")} in Settings before live Teamship pulls can run.`}
            </p>
            <p className="mt-2 text-xs leading-5 text-mutedForeground">
              The 15-minute daily-order sync route is scaffolded but intentionally not scheduled yet.
            </p>
          </div>
        </div>
      </section>

      <GarlandTeamshipReviewClient canDeleteRuns={context.role === "ADMIN"} />
    </div>
  );
}
