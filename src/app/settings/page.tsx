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
              <div key={module.key} className="flex items-center justify-between rounded-md border border-border bg-muted/40 p-3">
                <span className="font-medium text-foreground">{module.name}</span>
                <span className="text-sm text-mutedForeground">{module.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold text-foreground">Integration Boundaries</h2>
          <div className="mt-4 space-y-3 text-sm text-mutedForeground">
            {settings.integrationProviders.map((provider) => (
              <div key={provider} className="rounded-md border border-border bg-muted/40 p-3">
                <p className="font-medium text-foreground">{provider}</p>
                <p className="mt-1">
                  Placeholder only. Store non-secret tenant config and encrypted secret references
                  separately before enabling live API calls.
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
