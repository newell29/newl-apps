import { InvoiceAutomationStatus, ModuleKey, PlatformRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildInvoiceReviewPacketPdf } from "@/modules/invoice-automation/review-packet";
import { requireModule, requireRole } from "@/server/auth/authorization";
import { prisma } from "@/server/db";
import { getAuthenticatedContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

type ReviewPacketPayload = {
  invoiceIds?: unknown;
};

const REVIEW_PACKET_LIMIT = 50;

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedContext();
    await requireModule(context, ModuleKey.QUICKBOOKS_POSTING);
    requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER, PlatformRole.FINANCE]);

    const body = (await request.json().catch(() => null)) as ReviewPacketPayload | null;
    const invoiceIds = Array.isArray(body?.invoiceIds)
      ? body.invoiceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (invoiceIds.length === 0) {
      return NextResponse.json({ error: "Select at least one invoice for the review packet." }, { status: 400 });
    }

    if (invoiceIds.length > REVIEW_PACKET_LIMIT) {
      return NextResponse.json({ error: `Create review packets with ${REVIEW_PACKET_LIMIT} invoices or fewer.` }, { status: 400 });
    }

    const invoices = await prisma.invoiceAutomationInvoice.findMany({
      where: {
        tenantId: context.tenantId,
        id: { in: invoiceIds },
        status: {
          in: [
            InvoiceAutomationStatus.ACCOUNTING_REVIEW,
            InvoiceAutomationStatus.APPROVED_FOR_POSTING,
            InvoiceAutomationStatus.POSTING_ERROR
          ]
        }
      },
      include: {
        batch: {
          select: {
            batchNumber: true
          }
        },
        document: {
          select: {
            pdfBytes: true
          }
        }
      }
    });

    if (invoices.length !== invoiceIds.length) {
      return NextResponse.json({ error: "One or more selected invoices are no longer available in the accounting queue." }, { status: 404 });
    }

    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const orderedInvoices = invoiceIds.map((id) => invoiceById.get(id)).filter((invoice): invoice is NonNullable<typeof invoice> => Boolean(invoice));
    const pdfBytes = await buildInvoiceReviewPacketPdf(
      orderedInvoices.map((invoice) => ({
        id: invoice.id,
        batchNumber: invoice.batch.batchNumber,
        invoiceType: invoice.invoiceType,
        status: invoice.status,
        fileName: invoice.fileName,
        shipmentFileNumber: invoice.shipmentFileNumber,
        entityNameRaw: invoice.entityNameRaw,
        quickBooksEntityDisplayName: invoice.quickBooksEntityDisplayName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        subtotalAmount: invoice.subtotalAmount,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        pdfBytes: new Uint8Array(invoice.document.pdfBytes)
      }))
    );

    const batchNumber = orderedInvoices[0]?.batch.batchNumber ?? "invoice-review";
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${sanitizeFileName(`${batchNumber}-review-packet.pdf`)}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create invoice review packet." },
      { status: 500 }
    );
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
