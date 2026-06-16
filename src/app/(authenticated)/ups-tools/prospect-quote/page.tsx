import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { ProspectQuoteClient } from "@/modules/ups-tools/components/prospect-quote-client";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function ProspectQuotePage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.UPS_TOOLS);
  const shell = await getUpsToolsShell(context, "PROSPECT_QUOTE");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="UPS Tools"
        title="Prospect Quote Generator"
        description="Generate repeatable quote grids across popular or manual destination sets for sales and operations follow-up."
      />

      <ProspectQuoteClient accounts={shell.accounts} plannedSources={shell.plannedSources} />
    </div>
  );
}
