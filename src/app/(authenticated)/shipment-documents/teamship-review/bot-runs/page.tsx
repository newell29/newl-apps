import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { GarlandTeamshipBotRunsClient } from "@/modules/shipment-documents/components/garland-teamship-review-client";
import { GarlandToolTabs } from "@/modules/shipment-documents/components/garland-tool-tabs";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function GarlandTeamshipBotRunsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Garland Tools"
        title="Teamship bot runs"
        description="Review Teamship bot drafts, approve safe agent work, rescan completed jobs, and audit run evidence away from the daily shipment queue."
      />

      <GarlandToolTabs active="teamship-bot-runs" />

      <GarlandTeamshipBotRunsClient />
    </div>
  );
}
