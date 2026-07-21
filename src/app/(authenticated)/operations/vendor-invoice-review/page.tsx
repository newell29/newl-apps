import { ModuleKey } from "@prisma/client";
import { PageHeader } from "@/components/page-header";
import { VendorInvoiceReviewClient } from "@/modules/vendor-invoice-review/components/vendor-invoice-review-client";
import { getVendorInvoiceReviewPackages } from "@/modules/vendor-invoice-review/queries";
import { requireModule } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function VendorInvoiceReviewPage() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.INVOICE_VERIFICATION);
  const packages = await getVendorInvoiceReviewPackages(context, { invoiceKind: "Vendor_Invoices" });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Vendor invoice approval"
        description="Upload one vendor invoice PDF package, confirm detected invoice details, approve it, and save the stamped PDF package."
      />
      <VendorInvoiceReviewClient
        invoiceKind="Vendor_Invoices"
        initialPackages={packages}
        uploadUrl="/api/operations/vendor-invoice-review/uploads"
      />
    </div>
  );
}
