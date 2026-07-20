import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { InvoiceAutomationTabs } from "@/modules/invoice-automation/components";
import { InvoiceReconciliationClient } from "@/modules/invoice-automation/components/reconciliation-client";
import { getInvoiceAutomationReconciliationShell } from "@/modules/invoice-automation/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function InvoiceAutomationReconciliationPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
  const shell = await getInvoiceAutomationReconciliationShell(context);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Shipment reconciliation"
        description="Shipment-file profitability and risk review across customer invoices and vendor bills recorded in Newl Apps."
      />
      <InvoiceAutomationTabs />

      <section className="grid gap-4 md:grid-cols-5">
        <SummaryCard label="Shipments" value={shell.summary.shipmentCount} />
        <SummaryCard label="Vendor no customer" value={shell.summary.missingCustomerInvoice} />
        <SummaryCard label="Customer no vendor" value={shell.summary.missingVendorInvoice} />
        <SummaryCard label="High margin" value={shell.summary.highOrElevatedMargin} />
        <SummaryCard label="FX missing" value={shell.summary.fxMissing} />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">Shipment profitability and missing invoice risks</h2>
          <p className="mt-1 text-sm text-mutedForeground">
            Revenue and cost are grouped by shipment file number. CAD profit uses QuickBooks returned home-currency amounts for posted invoices, or CAD source amounts when invoices are not posted.
          </p>
        </div>
        <InvoiceReconciliationClient rows={shell.rows} />
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-mutedForeground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value.toLocaleString("en-US")}</p>
    </div>
  );
}
