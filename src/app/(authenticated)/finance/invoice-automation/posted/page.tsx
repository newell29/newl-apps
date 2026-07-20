import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { InvoiceAutomationTabs } from "@/modules/invoice-automation/components";
import { InvoiceRowsTable } from "@/modules/invoice-automation/components/invoice-upload-client";
import { getInvoiceAutomationPostedShell, type InvoiceAutomationFilters } from "@/modules/invoice-automation/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type SearchParams = Promise<InvoiceAutomationFilters>;

export default async function InvoiceAutomationPostedPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
  const filters = await searchParams;
  const shell = await getInvoiceAutomationPostedShell(context, filters);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Posted invoices"
        description="Posted QuickBooks invoice and bill history with the exchange rate and CAD home amounts returned by QuickBooks."
      />
      <InvoiceAutomationTabs />
      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">QuickBooks posting history</h2>
          <p className="mt-1 text-sm text-mutedForeground">Posted customer invoices and vendor bills remain searchable here with original PDFs, QuickBooks references, and CAD-equivalent amounts.</p>
        </div>
        <InvoiceRowsTable invoices={shell.invoices} showQuickBooksPostingDetails />
      </section>
    </div>
  );
}
