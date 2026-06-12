import { PageHeader } from "@/components/page-header";
import { getSettingsShell } from "@/modules/settings/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const tenant = await getCurrentTenantContext();
  const settings = await getSettingsShell(tenant);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tenant.tenantName}
        title="Settings"
        description="Tenant-scoped configuration shell for modules, credentials, roles, and future billing."
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Enabled Modules</h2>
          <div className="mt-4 space-y-3">
            {settings.modules.map((module) => (
              <div key={module.key} className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 p-3">
                <span className="font-medium text-foreground">{module.name}</span>
                <span className="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
                  {module.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Integration Boundaries</h2>
          <div className="mt-4 space-y-3 text-sm text-mutedForeground">
            {settings.integrationProviders.map((provider) => (
              <div key={provider} className="rounded-md border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-foreground">{provider}</p>
                  <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                    Placeholder
                  </span>
                </div>
                <p className="mt-2">
                  Store non-secret tenant config and encrypted secret references separately before
                  enabling live API calls.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
