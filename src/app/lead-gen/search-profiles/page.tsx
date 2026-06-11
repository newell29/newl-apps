import { PageHeader } from "@/components/page-header";
import { getTradeMiningSearchProfiles } from "@/modules/lead-gen/queries";
import { getCurrentTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function SearchProfilesPage() {
  const tenant = await getCurrentTenantContext();
  const { profiles, setupWarning } = await getTradeMiningSearchProfiles(tenant);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="TradeMining Search Profiles"
        description="Tenant-scoped configuration that future OpenClaw/n8n workers will fetch before running TradeMining pulls."
      />

      {setupWarning ? (
        <section className="rounded-lg border border-warning/25 bg-warning/10 p-5 text-sm leading-6 text-foreground shadow-sm">
          <h2 className="font-semibold">Profile setup required</h2>
          <p className="mt-1 text-mutedForeground">{setupWarning}</p>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Profile Admin Foundation</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Newl Apps is the source of truth for profile criteria, thresholds, schedules, and audit history.
              This milestone is read-only; create/edit actions will be added before worker ingestion is enabled.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            TODO: create/edit forms
          </span>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {profiles.map((profile) => (
          <article key={profile.id} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{profile.name}</h2>
                  <StatusBadge enabled={profile.enabled} />
                </div>
                {profile.description ? (
                  <p className="mt-2 text-sm leading-6 text-mutedForeground">{profile.description}</p>
                ) : null}
              </div>
              <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
                Weight {profile.priorityWeight}
              </span>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <ProfileField label="Destination markets" value={formatList(profile.destinationMarkets)} />
                <ProfileField label="Destination ports" value={formatList(profile.destinationPorts)} />
                <ProfileField label="Origin ports" value={formatList(profile.originPorts)} />
                <ProfileField label="Ship-from ports" value={formatList(profile.shipFromPorts)} />
                <ProfileField label="Origin countries" value={formatList(profile.originCountries)} />
                <ProfileField label="Products / keywords" value={formatList(profile.productKeywords)} />
                <ProfileField label="HS codes" value={formatList(profile.hsCodes)} />
                <ProfileField label="Last run" value={formatLastRun(profile.lastRunAt, profile.lastRunStatus)} />
              </div>

              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4">
                <Stat label="Lookback" value={`${profile.lookbackWindowDays} days`} />
                <Stat label="Min shipments" value={profile.minShipmentCount.toLocaleString("en-US")} />
                <Stat label="Min volume" value={profile.minShipmentVolume ?? "Not set"} />
                <Stat label="Schedule" value={`${profile.scheduleFrequency} / ${profile.scheduleTimezone}`} />
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  const classes = enabled
    ? "border-success/25 bg-success/10 text-success"
    : "border-border bg-muted text-mutedForeground";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {enabled ? "Enabled" : "Disabled"}
    </span>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-2 text-sm leading-5 text-foreground">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-mutedForeground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "Any / not configured";
}

function formatLastRun(lastRunAt: Date | null, status: string) {
  if (!lastRunAt) {
    return status;
  }

  return `${status} at ${lastRunAt.toLocaleString("en-US")}`;
}
