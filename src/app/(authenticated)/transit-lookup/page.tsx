import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { TransitLookupClient } from "@/modules/ups-tools/components/transit-lookup-client";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function TransitLookupPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.TRANSIT_LOOKUP);
  const shell = await getUpsToolsShell(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Transit Lookup"
        title="UPS Ground Transit Time"
        description="Upload or enter destination ZIPs and estimate tenant-scoped ground transit time from seeded UPS origin accounts."
      />

      <TransitLookupClient accounts={shell.accounts} />
    </div>
  );
}
