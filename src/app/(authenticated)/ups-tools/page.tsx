import Link from "next/link";
import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { getUpsToolsShell } from "@/modules/ups-tools/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function UpsToolsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.UPS_TOOLS);
  const shell = await getUpsToolsShell(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="UPS Tools"
        title="Rating And Quoting"
        description="Tenant-scoped UPS workflows for bulk shipment quoting, prospect quote generation, and future live carrier boundaries."
      />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Module overview</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              This rebuild keeps the old rate tool inside Newl Apps and moves account handling into tenant-scoped integration records. Quotes currently run through a dry-run engine so we can validate workflow, exports, and access control before live UPS secret resolution is enabled.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
            {shell.accounts.length.toLocaleString("en-US")} UPS accounts
          </span>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ToolCard
          href="/ups-tools/rate-quote"
          title="Shipment Rate Quote"
          description="Upload shipment CSVs, run multi-service pricing, and export quote outputs."
          badge="Bulk quoting"
        />
        <ToolCard
          href="/ups-tools/prospect-quote"
          title="Prospect Quote Generator"
          description="Fan a package profile across popular or manual destinations to produce quick prospect pricing grids."
          badge="Grid quoting"
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Tenant integration posture</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Stat label="Accounts available" value={shell.accounts.length.toLocaleString("en-US")} />
          <Stat
            label="Dry-run accounts"
            value={shell.accounts.filter((account) => account.dryRun).length.toLocaleString("en-US")}
          />
          <Stat
            label="Live secret refs"
            value={shell.accounts.filter((account) => account.secretConfigured).length.toLocaleString("en-US")}
          />
        </div>
      </section>
    </div>
  );
}

function ToolCard({
  href,
  title,
  description,
  badge
}: {
  href: string;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <Link href={href} className="block rounded-lg border border-border bg-card p-5 shadow-sm transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
          {badge}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-mutedForeground">{description}</p>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
