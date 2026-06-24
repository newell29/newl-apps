import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { ShipmentRateQuoteClient } from "@/modules/ups-tools/components/shipment-rate-quote-client";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import { requireModule } from "@/server/auth/authorization";
import { isUpsRuntimeConfigured } from "@/server/integrations/ups";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function ShipmentRateQuotePage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.UPS_TOOLS);
  const shell = await getUpsToolsShell(context, "SHIPMENT_RATE_QUOTE");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="UPS Tools"
        title="Shipment Rate Quote"
        description="Bulk rate quoting for uploaded shipment CSVs with multi-service comparisons and tenant-safe account selection."
      />

      <ShipmentRateQuoteClient
        accounts={shell.accounts}
        liveBridgeEnabled={isUpsRuntimeConfigured()}
        plannedSources={shell.plannedSources}
        recentBulkJobs={shell.recentBulkJobs}
      />
    </div>
  );
}
