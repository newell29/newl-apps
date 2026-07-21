import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { VendorInvoiceReviewClient } from "@/modules/vendor-invoice-review/components/vendor-invoice-review-client";
import { getVendorInvoiceReviewPackages } from "@/modules/vendor-invoice-review/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function CustomerInvoiceIntakePage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  const packages = await getVendorInvoiceReviewPackages(context, { invoiceKind: "Customer_Invoices" });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Customer invoice intake"
        description="Upload one customer invoice PDF, confirm detected invoice details, and save the original PDF package."
      />
      <VendorInvoiceReviewClient
        invoiceKind="Customer_Invoices"
        initialPackages={packages}
        uploadUrl="/api/operations/customer-invoice-intake/uploads"
      />
    </div>
  );
}
