import { CashflowCustomerTier, ModuleKey, PlatformRole } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { saveCashflowThresholdsAction, saveCustomerCreditSettingsAction } from "@/modules/customer-cashflow/actions";
import { CashflowTabs, formatEnum } from "@/modules/customer-cashflow/components";
import { getCashflowSettings } from "@/modules/customer-cashflow/queries";
import { requireModule, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CashflowSettingsPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.CUSTOMER_CASHFLOW);
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);
  const settings = await getCashflowSettings(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Credit Exposure Settings"
        description="Configurable thresholds, customer payment terms, billing triggers, owners, and over-limit controls."
      />
      <CashflowTabs />

      <form action={saveCashflowThresholdsAction} className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-foreground">Tenant Thresholds</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <NumberField label="Good gross margin %" name="goodGrossMarginPercent" defaultValue={settings.thresholds.goodGrossMarginPercent} />
          <NumberField label="Low margin warning %" name="lowMarginWarningPercent" defaultValue={settings.thresholds.lowMarginWarningPercent} />
          <NumberField label="Negative margin critical %" name="negativeMarginCriticalPercent" defaultValue={settings.thresholds.negativeMarginCriticalPercent} />
          <NumberField label="Collect warning beyond terms" name="collectionWarningDaysBeyondTerms" defaultValue={settings.thresholds.collectionWarningDaysBeyondTerms} />
          <NumberField label="High exposure warning %" name="highExposureWarningPercent" defaultValue={settings.thresholds.highExposureWarningPercent} />
          <NumberField label="Credit breach %" name="creditBreachPercent" defaultValue={settings.thresholds.creditBreachPercent} />
          <NumberField label="Cost not billed days" name="costNotBilledBusinessDays" defaultValue={settings.thresholds.costNotBilledBusinessDays} />
          <NumberField label="Delivered not billed days" name="deliveredNotBilledBusinessDays" defaultValue={settings.thresholds.deliveredNotBilledBusinessDays} />
          <SelectField label="Default billing trigger" name="defaultBillingTrigger" defaultValue={settings.thresholds.defaultBillingTrigger} options={settings.billingTriggers} />
          <label className="space-y-2 md:col-span-2 xl:col-span-3">
            <span className="text-sm font-medium text-foreground">Notes</span>
            <input name="notes" defaultValue={settings.thresholds.notes ?? ""} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </label>
        </div>
        <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
          Save thresholds
        </button>
      </form>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Customer Credit Controls</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Detroit Axle-style accounts can use port-arrival vendor payment, delivery billing, 30/45 day terms, 80% alerting, and 100% management review.
          </p>
        </div>
        {settings.customers.map((customer) => (
          <form key={customer.id} action={saveCustomerCreditSettingsAction} className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <input type="hidden" name="customerId" value={customer.id} />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">{customer.customerName}</h3>
                <p className="mt-1 text-sm text-mutedForeground">{customer.assignedCollectionsOwner ?? "No collections owner"} • {customer.assignedSalesRep ?? "No sales owner"}</p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input type="checkbox" name="requiresApprovalOverLimit" value="true" defaultChecked={customer.requiresApprovalOverLimit} />
                Management approval over limit
              </label>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <NumberField label="Payment terms days" name="customerTermsDays" defaultValue={customer.customerTermsDays} />
              <NumberField label="Credit limit" name="creditLimit" defaultValue={customer.creditLimit} />
              <NumberField label="Alert threshold %" name="alertThresholdPercent" defaultValue={customer.alertThresholdPercent} />
              <SelectField label="Tier override" name="customerTier" defaultValue={customer.customerTier} options={Object.values(CashflowCustomerTier)} />
              <SelectField label="Billing trigger" name="billingTrigger" defaultValue={customer.billingTrigger} options={settings.billingTriggers} />
              <SelectField label="Vendor payment trigger" name="vendorPaymentTrigger" defaultValue={customer.vendorPaymentTrigger} options={settings.billingTriggers} />
              <TextField label="Sales owner" name="assignedSalesRep" defaultValue={customer.assignedSalesRep ?? ""} />
              <TextField label="Collections owner" name="assignedCollectionsOwner" defaultValue={customer.assignedCollectionsOwner ?? ""} />
              <label className="space-y-2 md:col-span-2 xl:col-span-4">
                <span className="text-sm font-medium text-foreground">Notes</span>
                <input name="notes" defaultValue={customer.notes ?? ""} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </label>
            </div>
            <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primaryForeground transition-colors hover:bg-primaryHover">
              Save customer settings
            </button>
          </form>
        ))}
      </section>
    </div>
  );
}

function NumberField({ label, name, defaultValue }: { label: string; name: string; defaultValue: number }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input name={name} type="number" step="0.01" defaultValue={defaultValue} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
    </label>
  );
}

function TextField({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input name={name} defaultValue={defaultValue} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
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
  defaultValue: string;
  options: string[];
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <select name={name} defaultValue={defaultValue} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
        {options.map((option) => <option key={option} value={option}>{formatEnum(option)}</option>)}
      </select>
    </label>
  );
}
