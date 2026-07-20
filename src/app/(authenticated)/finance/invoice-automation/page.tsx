import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { InvoiceAutomationTabs } from "@/modules/invoice-automation/components";
import { InvoiceAutomationUploadClient } from "@/modules/invoice-automation/components/invoice-upload-client";
import { getInvoiceAutomationUploadShell, type InvoiceAutomationFilters } from "@/modules/invoice-automation/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<InvoiceAutomationFilters>;

export default async function InvoiceAutomationUploadPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  const filters = await searchParams;
  const shell = await getInvoiceAutomationUploadShell(context, filters);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Invoice automation"
        description="Operations intake for customer and vendor invoice PDFs before accounting review and QuickBooks posting."
      />
      <InvoiceAutomationTabs />

      <section className="grid gap-4 md:grid-cols-5">
        <SummaryCard label="Operations review" value={shell.summary.operationsReview} />
        <SummaryCard label="Accounting queue" value={shell.summary.accountingReview} />
        <SummaryCard label="Approved for posting" value={shell.summary.approvedForPosting} />
        <SummaryCard label="Posted" value={shell.summary.posted} />
        <SummaryCard label="Needs attention" value={shell.summary.needsAttention} />
      </section>

      <InvoiceAutomationUploadClient
        invoices={shell.invoices}
        entityOptions={shell.entityOptions}
        correctionMemories={shell.correctionMemories}
        quickBooksSync={shell.quickBooksSync}
      />
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
