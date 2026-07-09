import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { InvoiceAutomationTabs } from "@/modules/invoice-automation/components";
import { AccountingQueueClient } from "@/modules/invoice-automation/components/accounting-queue-client";
import { getInvoiceAutomationAccountingShell, getInvoiceAutomationEntityOptions, type InvoiceAutomationFilters } from "@/modules/invoice-automation/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<InvoiceAutomationFilters>;

export default async function InvoiceAutomationAccountingPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
  const filters = await searchParams;
  const [shell, entityOptions] = await Promise.all([
    getInvoiceAutomationAccountingShell(context, filters),
    getInvoiceAutomationEntityOptions(context)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Accounting queue"
        description="Reviewed customer and vendor invoices waiting for accounting approval. QuickBooks posting remains disabled while this workflow is in testing."
      />
      <InvoiceAutomationTabs />

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Ready for review" value={shell.summary.accountingReview} />
        <SummaryCard label="Approved for posting" value={shell.summary.approvedForPosting} />
        <SummaryCard label="Posting errors" value={shell.summary.postingErrors} />
      </section>

      <AccountingQueueClient invoices={shell.invoices} entityOptions={entityOptions} />
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
