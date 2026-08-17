import { ModuleKey, PlatformRole } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { TmgOrderIntakeClient } from "@/modules/shipment-documents/components/tmg-order-intake-client";
import { getTmgOrderIntakeSettings } from "@/modules/shipment-documents/tmg-settings";
import { requireModule, roleCanMutate } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function TmgOrderIntakePage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  const settings = await getTmgOrderIntakeSettings(context.tenantId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations Tools"
        title="TMG order intake"
        description="Review daily TMG email batches, approve exact shipping-order plans, and track Teamship creation and consolidated document upload. This workflow is separate from Garland."
      />

      <TmgOrderIntakeClient
        initialSettings={settings}
        canConfigure={context.role === PlatformRole.ADMIN}
        canApprove={roleCanMutate(context.role)}
      />
    </div>
  );
}
