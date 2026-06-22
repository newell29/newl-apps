import { PageHeader } from "@/components/page-header";
import {
  createCarrierPlaceholderAction,
  createUpsQuoteSourceAction,
  saveTradeMiningScoringSettingsAction,
  syncSevenLCarriersAction,
  updateSevenLCarrierSelectionAction
} from "@/modules/settings/actions";
import { getSettingsShell } from "@/modules/settings/queries";
import { requireAdmin } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getAuthenticatedContext();
  requireAdmin(context);
  const settings = await getSettingsShell(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={context.tenantName}
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

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">TradeMining Scoring</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Tune lead ranking for the TradeMining trial without changing the existing Sheets workflow. These settings control growth, profile fit, industry preference, company size bias, and workflow penalties.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            Deterministic scoring
          </span>
        </div>

        <form action={saveTradeMiningScoringSettingsAction} className="mt-4 space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-md border border-border bg-background p-4">
              <h3 className="text-sm font-semibold text-foreground">Windows</h3>
              <div className="mt-4 grid gap-3">
                <NumberField
                  label="Recent window (days)"
                  name="recentWindowDays"
                  defaultValue={settings.tradeMiningScoring.recentWindowDays}
                  min={7}
                  max={365}
                />
                <NumberField
                  label="Comparison window (days)"
                  name="comparisonWindowDays"
                  defaultValue={settings.tradeMiningScoring.comparisonWindowDays}
                  min={7}
                  max={365}
                />
                <NumberField
                  label="Scoring lookback (days)"
                  name="lookbackWindowDays"
                  defaultValue={settings.tradeMiningScoring.lookbackWindowDays}
                  min={30}
                  max={365}
                />
              </div>
            </div>

            <div className="rounded-md border border-border bg-background p-4">
              <h3 className="text-sm font-semibold text-foreground">Weights</h3>
              <div className="mt-4 grid gap-3">
                <NumberField label="Momentum" name="momentumWeight" defaultValue={settings.tradeMiningScoring.momentumWeight} min={0} max={100} />
                <NumberField label="Market fit" name="marketFitWeight" defaultValue={settings.tradeMiningScoring.marketFitWeight} min={0} max={100} />
                <NumberField label="Industry fit" name="industryFitWeight" defaultValue={settings.tradeMiningScoring.industryFitWeight} min={0} max={100} />
                <NumberField label="Company size" name="companySizeWeight" defaultValue={settings.tradeMiningScoring.companySizeWeight} min={0} max={100} />
                <NumberField label="Role" name="roleWeight" defaultValue={settings.tradeMiningScoring.roleWeight} min={0} max={100} />
                <NumberField label="Confidence" name="confidenceWeight" defaultValue={settings.tradeMiningScoring.confidenceWeight} min={0} max={100} />
                <NumberField label="Workflow" name="workflowWeight" defaultValue={settings.tradeMiningScoring.workflowWeight} min={0} max={100} />
              </div>
            </div>

            <div className="rounded-md border border-border bg-background p-4">
              <h3 className="text-sm font-semibold text-foreground">Company size rules</h3>
              <div className="mt-4 grid gap-3">
                <DecimalField
                  label="Mid-market TEU min"
                  name="midMarketTeuMin"
                  defaultValue={settings.tradeMiningScoring.midMarketTeuMin}
                  placeholder="2"
                />
                <DecimalField
                  label="Mid-market TEU max"
                  name="midMarketTeuMax"
                  defaultValue={settings.tradeMiningScoring.midMarketTeuMax}
                  placeholder="15"
                />
                <NumberField label="Mid-market boost" name="midMarketBoost" defaultValue={settings.tradeMiningScoring.midMarketBoost} min={0} max={100} />
                <DecimalField
                  label="Oversize TEU threshold"
                  name="oversizeTeuThreshold"
                  defaultValue={settings.tradeMiningScoring.oversizeTeuThreshold}
                  placeholder="30"
                />
                <NumberField
                  label="Oversize shipments in recent window"
                  name="oversizeShipmentCount30dThreshold"
                  defaultValue={settings.tradeMiningScoring.oversizeShipmentCount30dThreshold ?? undefined}
                  min={1}
                  max={500}
                />
                <NumberField label="Oversize penalty" name="oversizePenalty" defaultValue={settings.tradeMiningScoring.oversizePenalty} min={0} max={100} />
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TextAreaField
              label="Preferred industry keywords"
              name="preferredIndustryKeywords"
              defaultValue={settings.tradeMiningScoring.preferredIndustryKeywords.join("\n")}
              description="One per line or comma-separated."
            />
            <TextAreaField
              label="Penalized industry keywords"
              name="penalizedIndustryKeywords"
              defaultValue={settings.tradeMiningScoring.penalizedIndustryKeywords.join("\n")}
              description="Use this for brokers, carriers, or categories you do not want to prioritize."
            />
            <TextAreaField
              label="Preferred HS code prefixes"
              name="preferredHsCodePrefixes"
              defaultValue={settings.tradeMiningScoring.preferredHsCodePrefixes.join("\n")}
              description="Prefix matches are supported."
            />
            <TextAreaField
              label="Penalized HS code prefixes"
              name="penalizedHsCodePrefixes"
              defaultValue={settings.tradeMiningScoring.penalizedHsCodePrefixes.join("\n")}
              description="Leave blank if unused."
            />
          </div>

          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Future AI classification</h3>
                <p className="mt-1 text-sm text-mutedForeground">
                  This stays off for now. The deterministic score remains the source of truth until we are happy with the trial inputs and ranking behavior.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  name="aiClassificationEnabled"
                  value="true"
                  defaultChecked={settings.tradeMiningScoring.aiClassificationEnabled}
                />
                Enable AI classification
              </label>
            </div>
            <div className="mt-4 max-w-sm">
              <OptionalField
                label="AI model"
                name="aiModel"
                defaultValue={settings.tradeMiningScoring.aiModel ?? ""}
                placeholder="gpt-5-mini"
              />
            </div>
          </div>

          <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
            Save scoring settings
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Quote Sources</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Manage the source records that can feed Shipment Rate Quote and Prospect Quote Generator. UPS accounts are quotable today; planned carriers can be staged here now and promoted later when their API boundary is wired.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            {settings.quoteSources.length.toLocaleString("en-US")} total
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.quoteSources.map((source) => (
            <div key={source.id} className="rounded-md border border-border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{source.displayName}</p>
                  <p className="mt-1 text-sm text-mutedForeground">
                    {source.carrierName} • {source.carrierCode} • {source.readiness === "live" ? "Live-ready" : "Planned"}
                  </p>
                </div>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {source.sourceKind === "UPS_ACCOUNT" ? "UPS account" : "Future carrier"}
                </span>
              </div>
              <p className="mt-3 text-sm text-mutedForeground">
                {source.shipperNumber
                  ? `${source.originLabel} (${source.originPostalCode}) • ${source.shipperNumber}`
                  : source.notes ?? "Will appear in quote tooling as a planned source until its integration is connected."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                {source.toolTargets.map((target) => (
                  <span key={target} className="rounded-full border border-border bg-background px-2.5 py-1 text-mutedForeground">
                    {target === "SHIPMENT_RATE_QUOTE" ? "Shipment Rate Quote" : "Prospect Quote Generator"}
                  </span>
                ))}
                <span className="rounded-full border border-border bg-background px-2.5 py-1 text-mutedForeground">
                  {source.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          <form action={createUpsQuoteSourceAction} className="rounded-md border border-border bg-background p-4">
            <h3 className="text-sm font-semibold text-foreground">Add UPS account</h3>
            <p className="mt-1 text-sm text-mutedForeground">
              Create or update a UPS source by shipper number. If it matches your local UPS credentials file, it will become live in the quote tools automatically.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Display name" name="displayName" placeholder="Charlotte Main UPS" />
              <Field label="Shipper number" name="shipperNumber" placeholder="G460D6" />
              <SelectField
                label="Country"
                name="countryCode"
                options={[
                  { value: "US", label: "United States" },
                  { value: "CA", label: "Canada" }
                ]}
              />
              <SelectField
                label="Status"
                name="status"
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "DISABLED", label: "Disabled" },
                  { value: "ERROR", label: "Error" }
                ]}
              />
              <Field label="Origin postal code" name="originPostalCode" placeholder="28273" />
              <Field label="Origin label" name="originLabel" placeholder="Charlotte, NC" />
              <Field label="Origin state / province" name="originStateProvince" placeholder="NC" />
              <SelectField
                label="Runtime mode"
                name="dryRun"
                options={[
                  { value: "false", label: "Live-ready" },
                  { value: "true", label: "Dry run" }
                ]}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="SHIPMENT_RATE_QUOTE" defaultChecked />
                Shipment Rate Quote
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="PROSPECT_QUOTE" defaultChecked />
                Prospect Quote Generator
              </label>
            </div>
            <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save UPS source
            </button>
          </form>

          <form action={createCarrierPlaceholderAction} className="rounded-md border border-border bg-background p-4">
            <h3 className="text-sm font-semibold text-foreground">Stage future carrier</h3>
            <p className="mt-1 text-sm text-mutedForeground">
              Add FedEx, DHL, USPS, or any other planned carrier now so operations can see the target source in the quote workflow before we connect its pricing engine.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Display name" name="displayName" placeholder="FedEx Priority Account" />
              <Field label="Carrier name" name="carrierName" placeholder="FedEx" />
              <Field label="Carrier code" name="carrierCode" placeholder="FDX" />
              <SelectField
                label="Status"
                name="status"
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "DISABLED", label: "Disabled" },
                  { value: "ERROR", label: "Error" }
                ]}
              />
            </div>
            <label className="mt-3 block space-y-1 text-sm font-medium text-foreground">
              <span>Notes</span>
              <textarea
                name="notes"
                rows={4}
                placeholder="API owner, account notes, connection status, access requirements..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="SHIPMENT_RATE_QUOTE" defaultChecked />
                Shipment Rate Quote
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="toolTargets" value="PROSPECT_QUOTE" defaultChecked />
                Prospect Quote Generator
              </label>
            </div>
            <button className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
              Add planned carrier
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">UPS Accounts</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Tenant-scoped account records used by the UPS tools module. Current seed data is dry-run only and keeps live credentials out of the app surface.
            </p>
          </div>
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
            {settings.upsAccounts.length.toLocaleString("en-US")} configured
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.upsAccounts.map((account) => (
            <div key={account.id} className="rounded-md border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-foreground">{account.name}</p>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {account.dryRun ? "Dry run" : "Live-ready"}
                </span>
              </div>
              <p className="mt-2 text-sm text-mutedForeground">
                {account.originLabel} ({account.originPostalCode}) • {account.countryCode} • {account.shipperNumber}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">7L Accounts</h2>
            <p className="mt-1 text-sm leading-6 text-mutedForeground">
              Tenant-scoped 7L account records for the LTL Rate Portal. Sync the live carrier directory from 7L, then choose which carriers should be included in bulk pulls for this tenant.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
              {settings.sevenLAccounts.length.toLocaleString("en-US")} configured
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.sevenLAccounts.map((account) => (
            <div key={account.id} className="rounded-md border border-border bg-muted/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-foreground">{account.name}</p>
                  <p className="mt-2 text-sm text-mutedForeground">
                    {account.carriers.length} carriers • {account.carriers.filter((carrier) => carrier.enabled).length} enabled • {account.defaultUom} UOM • {account.harmonizedCharges ? "harmonized charges" : "base charges"}
                  </p>
                </div>
                <span className="rounded-full border border-accentBorder bg-accentSoft px-2.5 py-1 text-xs font-semibold text-primary">
                  {account.secretConfigured ? "Local runtime ready" : account.dryRun ? "Dry run" : "Live-ready"}
                </span>
              </div>

              <form action={syncSevenLCarriersAction} className="mt-4">
                <input type="hidden" name="accountId" value={account.id} />
                <button className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                  Sync 7L carriers
                </button>
              </form>

              <form action={updateSevenLCarrierSelectionAction} className="mt-4 space-y-3">
                <input type="hidden" name="accountId" value={account.id} />
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border bg-background p-3">
                  {account.carriers.map((carrier) => (
                    <label key={carrier.carrierHash} className="flex items-start gap-3 text-sm text-foreground">
                      <input
                        type="checkbox"
                        name="enabledCarrierHash"
                        value={carrier.carrierHash}
                        defaultChecked={carrier.enabled}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium text-foreground">{carrier.name}</span>
                        <span className="block text-xs text-mutedForeground">
                          {carrier.code} • {carrier.scac} {carrier.defaulted ? "• default account carrier" : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                  {account.carriers.length === 0 ? (
                    <p className="text-sm text-mutedForeground">
                      No carrier directory is loaded yet. Sync this account against 7L to import your carrier list.
                    </p>
                  ) : null}
                </div>
                <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
                  Save enabled carriers
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  placeholder
}: {
  label: string;
  name: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        required
        name={name}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function OptionalField({
  label,
  name,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
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
        required
        type="number"
        name={name}
        defaultValue={defaultValue}
        min={min}
        max={max}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function DecimalField({
  label,
  name,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <input
        type="number"
        step="0.01"
        min={0}
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
    </label>
  );
}

function TextAreaField({
  label,
  name,
  defaultValue,
  description
}: {
  label: string;
  name: string;
  defaultValue?: string;
  description?: string;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <textarea
        name={name}
        rows={5}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
      {description ? <span className="block text-xs font-normal text-mutedForeground">{description}</span> : null}
    </label>
  );
}

function SelectField({
  label,
  name,
  options
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1 text-sm font-medium text-foreground">
      <span>{label}</span>
      <select
        required
        name={name}
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
