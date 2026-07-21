import { ModuleKey, PlatformRole } from "@prisma/client";

import { NemoFeedbackClient } from "@/modules/assistant/components/nemo-feedback-client";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function NemoFeedbackPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.SHIPMENT_DOCUMENTS);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">Garland + Nemo</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Feedback and approved understanding</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-mutedForeground">
          Employees can report an incorrect result here or through Teams. Reports remain evidence until an administrator confirms them and explicitly promotes a lesson for Nemo.
        </p>
      </section>
      <NemoFeedbackClient isAdmin={context.role === PlatformRole.ADMIN} />
    </div>
  );
}
