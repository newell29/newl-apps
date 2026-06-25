import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import {
  createTradeMiningSearchProfileAction,
  deleteTradeMiningSearchProfileAction,
  requestTradeMiningSearchProfileRunAction,
  updateTradeMiningSearchProfileAction
} from "@/modules/lead-gen/actions";
import { MultiValueSuggestField } from "@/modules/lead-gen/components/multi-value-suggest-field";
import {
  defaultTradeMiningCompanyIdentityRoles,
  tradeMiningCompanyIdentityRoleOptions
} from "@/modules/lead-gen/search-profile-validation";
import { getTradeMiningSearchProfiles } from "@/modules/lead-gen/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function SearchProfilesPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.LEAD_GEN);
  const { profiles, setupWarning } = await getTradeMiningSearchProfiles(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lead Generation"
        title="TradeMining Search Profiles"
        description="Manage the tenant-scoped profiles that OpenClaw will use to decide which TradeMining lanes and thresholds to mirror into Newl Apps."
      />

      {setupWarning ? (
        <section className="rounded-lg border border-warning/25 bg-warning/10 p-5 text-sm leading-6 text-foreground shadow-sm">
          <h2 className="font-semibold">Profile setup required</h2>
          <p className="mt-1 text-mutedForeground">{setupWarning}</p>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Add search profile</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-mutedForeground">
              Create new TradeMining profile rules here so trial pulls can be adjusted without touching seed data or OpenClaw code.
            </p>
          </div>
          <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
            CRUD enabled
          </span>
        </div>

        <form action={createTradeMiningSearchProfileAction} className="mt-4">
          <SearchProfileForm />
          <div className="mt-4">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Create search profile
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Existing profiles</h2>
            <p className="mt-1 text-sm text-mutedForeground">
              Edit thresholds, destinations, origin preferences, schedules, and status for each active TradeMining pull target.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            {profiles.length.toLocaleString("en-US")} configured
          </span>
        </div>

        <div className="grid gap-4">
          {profiles.map((profile) => (
            <article key={profile.id} className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <details className="group" open={Boolean(profile.pendingRunStatus)}>
                <summary className="cursor-pointer list-none bg-muted px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-foreground">{profile.name}</h3>
                        <StatusBadge enabled={profile.enabled} />
                        {profile.pendingRunStatus ? <PendingRunBadge status={profile.pendingRunStatus} /> : null}
                        <span className="rounded-full border border-accentBorder bg-accentSoft px-3 py-1 text-xs font-semibold text-primary">
                          Weight {profile.priorityWeight}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-mutedForeground">
                        {summarizeProfileFocus(profile)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mutedForeground">
                        <span>Last run: {formatLastRun(profile.lastRunAt, profile.lastRunStatus)}</span>
                        <span>
                          {profile.lookbackWindowDays}d lookback | min {profile.minShipmentCount} shipment
                          {profile.minShipmentCount === 1 ? "" : "s"}
                        </span>
                        <span>{profile.scheduleFrequency} schedule</span>
                      </div>
                      {profile.pendingRunRequestedAt ? (
                        <p className="mt-1 text-xs text-primary">
                          Immediate run requested {profile.pendingRunRequestedAt.toLocaleString("en-US")}
                        </p>
                      ) : null}
                    </div>
                    <span className="mt-1 text-xs font-semibold text-mutedForeground transition-transform group-open:rotate-180">
                      v
                    </span>
                  </div>
                </summary>

                <div className="border-t border-border p-5">
                  <form action={updateTradeMiningSearchProfileAction}>
                    <input type="hidden" name="profileId" value={profile.id} />
                    <SearchProfileForm
                      defaults={{
                        name: profile.name,
                        description: profile.description ?? "",
                        enabled: profile.enabled,
                        destinationMarkets: profile.destinationMarkets.join("\n"),
                        destinationPorts: profile.destinationPorts.join("\n"),
                        originPorts: profile.originPorts.join("\n"),
                        shipFromPorts: profile.shipFromPorts.join("\n"),
                        originCountries: profile.originCountries.join("\n"),
                        productKeywords: profile.productKeywords.join("\n"),
                        hsCodes: profile.hsCodes.join("\n"),
                        allowedCompanyIdentityRoles: profile.allowedCompanyIdentityRoles,
                        excludedCompanyKeywords: profile.excludedCompanyKeywords.join("\n"),
                        lookbackWindowDays: profile.lookbackWindowDays,
                        minShipmentCount: profile.minShipmentCount,
                        minShipmentVolume: profile.minShipmentVolume ?? "",
                        scheduleFrequency: profile.scheduleFrequency,
                        scheduleTimezone: profile.scheduleTimezone,
                        priorityWeight: profile.priorityWeight
                      }}
                    />
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                        Save profile
                      </button>
                    </div>
                  </form>

                  <div className="mt-3 flex flex-wrap gap-3">
                    <form action={requestTradeMiningSearchProfileRunAction}>
                      <input type="hidden" name="profileId" value={profile.id} />
                      <button
                        disabled={Boolean(profile.pendingRunStatus) || !profile.enabled}
                        className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {profile.pendingRunStatus
                          ? profile.pendingRunStatus === "RUNNING"
                            ? "Run in progress"
                            : "Run requested"
                          : "Run now"}
                      </button>
                    </form>

                    <form action={deleteTradeMiningSearchProfileAction}>
                      <input type="hidden" name="profileId" value={profile.id} />
                      <button className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger/10">
                        Delete profile
                      </button>
                    </form>
                  </div>
                </div>
              </details>
            </article>
          ))}

          {profiles.length === 0 && !setupWarning ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-mutedForeground shadow-sm">
              No TradeMining profiles are configured yet. Create the first one above.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function summarizeProfileFocus(profile: {
  destinationMarkets: string[];
  destinationPorts: string[];
  originCountries: string[];
  productKeywords: string[];
  hsCodes: string[];
}) {
  const summaryParts: string[] = [];

  if (profile.destinationMarkets.length > 0) {
    summaryParts.push(`Destinations: ${profile.destinationMarkets.slice(0, 3).join(", ")}`);
  }

  if (profile.destinationPorts.length > 0) {
    summaryParts.push(`Ports: ${profile.destinationPorts.slice(0, 2).join(", ")}`);
  }

  if (profile.originCountries.length > 0) {
    summaryParts.push(`Origins: ${profile.originCountries.slice(0, 2).join(", ")}`);
  }

  if (profile.productKeywords.length > 0) {
    summaryParts.push(`Products: ${profile.productKeywords.slice(0, 2).join(", ")}`);
  } else if (profile.hsCodes.length > 0) {
    summaryParts.push(`HS: ${profile.hsCodes.slice(0, 3).join(", ")}`);
  }

  return summaryParts.length > 0 ? summaryParts.join(" | ") : "No lane focus configured yet.";
}

function SearchProfileForm({
  defaults
}: {
  defaults?: {
    name: string;
    description: string;
    enabled: boolean;
    destinationMarkets: string;
    destinationPorts: string;
    originPorts: string;
    shipFromPorts: string;
    originCountries: string;
    productKeywords: string;
    hsCodes: string;
    allowedCompanyIdentityRoles: string[];
    excludedCompanyKeywords: string;
    lookbackWindowDays: number;
    minShipmentCount: number;
    minShipmentVolume: string;
    scheduleFrequency: string;
    scheduleTimezone: string;
    priorityWeight: number;
  };
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 rounded-md border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Identity</h3>
        <Field label="Profile name" name="name" defaultValue={defaults?.name} required />
        <TextAreaField label="Description" name="description" rows={3} defaultValue={defaults?.description} />
        <ToggleField label="Enabled" name="enabled" defaultChecked={defaults?.enabled ?? true} />
      </div>

      <div className="space-y-4 rounded-md border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Lane filters</h3>
        <MultiValueSuggestField
          label="Destination markets"
          name="destinationMarkets"
          defaultValue={defaults?.destinationMarkets}
          suggestionField="destinationMarkets"
          description="Required. One per line or comma-separated."
        />
        <MultiValueSuggestField
          label="Destination ports"
          name="destinationPorts"
          defaultValue={defaults?.destinationPorts}
          suggestionField="destinationPorts"
        />
        <MultiValueSuggestField
          label="Origin ports"
          name="originPorts"
          defaultValue={defaults?.originPorts}
          suggestionField="originPorts"
        />
        <MultiValueSuggestField
          label="Ship-from ports"
          name="shipFromPorts"
          defaultValue={defaults?.shipFromPorts}
          suggestionField="shipFromPorts"
        />
        <MultiValueSuggestField
          label="Origin countries"
          name="originCountries"
          defaultValue={defaults?.originCountries}
          suggestionField="originCountries"
        />
      </div>

      <div className="space-y-4 rounded-md border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Product + thresholds</h3>
        <TextAreaField label="Product keywords" name="productKeywords" rows={4} defaultValue={defaults?.productKeywords} />
        <TextAreaField label="HS codes" name="hsCodes" rows={4} defaultValue={defaults?.hsCodes} />
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Allowed company identity roles</p>
          <p className="text-xs font-normal text-mutedForeground">
            Only these TradeMining roles can create companies in Newl Apps for this profile.
          </p>
          <div className="grid gap-2">
            {tradeMiningCompanyIdentityRoleOptions.map((option) => {
              const selectedRoles = defaults?.allowedCompanyIdentityRoles ?? defaultTradeMiningCompanyIdentityRoles;
              return (
                <label key={option.value} className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    name="allowedCompanyIdentityRole"
                    value={option.value}
                    defaultChecked={selectedRoles.includes(option.value)}
                    className="mt-1"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
        <TextAreaField
          label="Excluded company keywords"
          name="excludedCompanyKeywords"
          rows={4}
          defaultValue={defaults?.excludedCompanyKeywords}
          description="One per line or comma-separated. Matching company identities are skipped during ingestion."
        />
        <NumberField label="Lookback window days" name="lookbackWindowDays" defaultValue={defaults?.lookbackWindowDays ?? 90} min={1} max={365} />
        <NumberField label="Minimum shipment count" name="minShipmentCount" defaultValue={defaults?.minShipmentCount ?? 1} min={0} max={100000} />
        <DecimalField label="Minimum shipment volume" name="minShipmentVolume" defaultValue={defaults?.minShipmentVolume} />
        <NumberField label="Priority weight" name="priorityWeight" defaultValue={defaults?.priorityWeight ?? 50} min={0} max={100} />
        <SelectField
          label="Schedule frequency"
          name="scheduleFrequency"
          defaultValue={defaults?.scheduleFrequency ?? "daily"}
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "manual", label: "Manual" }
          ]}
        />
        <Field label="Schedule timezone" name="scheduleTimezone" defaultValue={defaults?.scheduleTimezone ?? "America/Toronto"} required />
      </div>
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

function PendingRunBadge({ status }: { status: string }) {
  const label = status === "RUNNING" ? "Immediate run in progress" : "Immediate run queued";

  return (
    <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
      {label}
    </span>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function NumberField({
  label,
  name,
  defaultValue,
  min,
  max
}: {
  label: string;
  name: string;
  defaultValue?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        required
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function DecimalField({
  label,
  name,
  defaultValue
}: {
  label: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        type="number"
        step="0.01"
        min={0}
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function TextAreaField({
  label,
  name,
  rows,
  defaultValue,
  description
}: {
  label: string;
  name: string;
  rows: number;
  defaultValue?: string;
  description?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
      {description ? <span className="block text-xs font-normal text-mutedForeground">{description}</span> : null}
    </label>
  );
}

function ToggleField({
  label,
  name,
  defaultChecked
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatLastRun(lastRunAt: Date | null, status: string) {
  if (!lastRunAt) {
    return status;
  }

  return `${status} at ${lastRunAt.toLocaleString("en-US")}`;
}
