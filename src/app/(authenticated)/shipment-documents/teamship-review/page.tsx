import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { GarlandTeamshipReviewClient } from "@/modules/shipment-documents/components/garland-teamship-review-client";
import { GarlandToolTabs } from "@/modules/shipment-documents/components/garland-tool-tabs";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function GarlandTeamshipReviewPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Garland Tools"
        title="Teamship order review"
        description="Review Garland email intake results, Teamship update outcomes, and shipment issues that need CSR attention."
      />

      <GarlandToolTabs active="teamship-review" />

      <GarlandTeamshipReviewClient canDeleteRuns={context.role === "ADMIN"} />
    </div>
  );
}
