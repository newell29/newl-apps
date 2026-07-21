import { saveInvoiceReviewUpload } from "@/app/api/operations/vendor-invoice-review/uploads/route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return saveInvoiceReviewUpload(request, "Customer_Invoices");
}
