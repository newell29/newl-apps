import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { GarlandEmailIntakeClient } from "@/modules/shipment-documents/components/garland-email-intake-client";
import { GarlandToolTabs } from "@/modules/shipment-documents/components/garland-tool-tabs";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function GarlandTeamshipEmailIntakePage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Garland Tools"
        title="Garland email intake"
        description="Automatically scan the configured warehouse mailbox for Garland PDF batches, group duplicate follow-ups, and prepare source emails for Teamship review."
      />

      <GarlandToolTabs active="teamship-email-intake" />

      <GarlandEmailIntakeClient />
    </div>
  );
}
