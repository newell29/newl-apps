import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { LtlRatePortalClient } from "@/modules/ltl-rate-portal/components/ltl-rate-portal-client";
import { getLtlRatePortalShell } from "@/modules/ltl-rate-portal/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function LtlRatePortalPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LTL_RATE_PORTAL);
  const shell = await getLtlRatePortalShell(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="LTL Rate Portal"
        title="Bulk LTL lane quoting"
        description="Upload a lane template, compare carrier results across tenant-scoped 7L account configs, and export bulk quote results for RFQs."
      />

      <LtlRatePortalClient accounts={shell.accounts} recentBulkJobs={shell.recentBulkJobs} />
    </div>
  );
}
