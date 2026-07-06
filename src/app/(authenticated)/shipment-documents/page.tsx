import { ModuleKey } from "@prisma/client";

import { PageHeader } from "@/components/page-header";
import { GarlandDailyPackClient } from "@/modules/shipment-documents/components/garland-daily-pack-client";
import { getShipmentDocumentRunHistory } from "@/modules/shipment-documents/queries";
import { requireModule } from "@/server/auth/authorization";
import { isOpenAiDraftGenerationConfigured } from "@/server/integrations/openai";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function ShipmentDocumentsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);
  const history = await getShipmentDocumentRunHistory(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Garland Tools"
        title="BOL consolidation"
        description="Upload the day's BOL bundle and pick-ticket bundle, sort each document set by PS number, then download clean customer-ready PDFs."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
          <div>
            <h2 className="text-base font-semibold text-foreground">Workflow</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              This CSR workflow is designed for Garland Canada daily outbound packages. The app extracts the PS
              number from each BOL and pick-ticket page, sorts lowest to highest, and rebuilds two separate PDFs.
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">AI fallback status</p>
            <p className="mt-2 text-sm text-foreground">
              {isOpenAiDraftGenerationConfigured()
                ? "Configured in this runtime. Scanned pages can fall back to AI PS-number detection when text extraction is blank."
                : "Not configured in this runtime. Text-native PDFs will still work, but scanned pages need OPENAI_API_KEY before AI fallback can run."}
            </p>
            <p className="mt-2 text-xs leading-5 text-mutedForeground">
              This status reflects the environment the app is currently running in. If Vercel has
              <code className="mx-1 rounded bg-background px-1 py-0.5 text-[11px]">OPENAI_API_KEY</code>
              set but your local `.env` does not, deployed fallback can work even when local development shows as unavailable.
            </p>
          </div>
        </div>
      </section>

      <GarlandDailyPackClient initialHistory={history} />
    </div>
  );
}
