import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { GarlandCarrierManifestClient } from "@/modules/shipment-documents/components/garland-carrier-manifest-client";
import { GarlandToolTabs } from "@/modules/shipment-documents/components/garland-tool-tabs";
import { getGarlandCarrierManifestHistory } from "@/modules/shipment-documents/carrier-manifest-queries";
import { requireModule } from "@/server/auth/authorization";
import { isOpenAiDraftGenerationConfigured } from "@/server/integrations/openai";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function GarlandCarrierManifestsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  const history = await getGarlandCarrierManifestHistory(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Garland Tools"
        title="Carrier manifests"
        description="Upload the day's BOL bundle and generate editable loading manifests for Midland, Speedy, and Suretrack."
      />

      <GarlandToolTabs active="carrier-manifests" />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
          <div>
            <h2 className="text-base font-semibold text-foreground">Workflow</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Upload the daily Garland BOL bundle. The app reads each BOL, keeps only Midland, Speedy, and Suretrack
              shipments, then prepares one editable Excel file per carrier for warehouse loading checks.
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">AI extraction status</p>
            <p className="mt-2 text-sm text-foreground">
              {isOpenAiDraftGenerationConfigured()
                ? "Configured in this runtime. Scanned BOL pages can be read for carrier, SR, PS, city, and skid counts."
                : "Not configured in this runtime. Add OPENAI_API_KEY before scanned carrier manifest extraction can run."}
            </p>
          </div>
        </div>
      </section>

      <GarlandCarrierManifestClient initialHistory={history} />
    </div>
  );
}
