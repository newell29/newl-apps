import { describe, expect, it } from "vitest";
import { filterQuickBooksTransactionsForReconciliation } from "@/modules/invoice-automation/queries";

describe("invoice automation reconciliation QBO de-dupe", () => {
  it("excludes QBO vendor rows already represented by a Newl Apps invoice transaction ID", () => {
    const rows = filterQuickBooksTransactionsForReconciliation(
      [
        qboRow({
          invoiceType: "VENDOR",
          quickBooksTxnId: "qb-bill-1",
          quickBooksTxnNumber: "FCLCSH26061338-1-D1",
          shipmentFileNumber: "OI433N69"
        }),
        qboRow({
          invoiceType: "VENDOR",
          quickBooksTxnId: "qb-bill-2",
          quickBooksTxnNumber: "FCLCSH26061338-2-D1",
          shipmentFileNumber: "OI433N69"
        })
      ],
      [
        newlRow({
          invoiceType: "VENDOR",
          quickBooksTxnId: "qb-bill-1",
          invoiceNumber: "FCLCSH26061338-1-D1",
          shipmentFileNumber: "OI433N69"
        })
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.quickBooksTxnNumber).toBe("FCLCSH26061338-2-D1");
  });

  it("excludes QBO customer rows already represented by the same file and invoice number", () => {
    const rows = filterQuickBooksTransactionsForReconciliation(
      [
        qboRow({
          invoiceType: "CUSTOMER",
          quickBooksTxnId: "qb-invoice-1",
          quickBooksTxnNumber: "7412",
          shipmentFileNumber: "OI433N69"
        })
      ],
      [
        newlRow({
          invoiceType: "CUSTOMER",
          invoiceNumber: "7412",
          shipmentFileNumber: "OI433N69"
        })
      ]
    );

    expect(rows).toEqual([]);
  });

  it("keeps legitimate additional QBO bills for the same file when bill numbers differ", () => {
    const rows = filterQuickBooksTransactionsForReconciliation(
      [
        qboRow({
          invoiceType: "VENDOR",
          quickBooksTxnId: "qb-bill-2",
          quickBooksTxnNumber: "FCLCSH26061338-2-D1",
          shipmentFileNumber: "OI433N69"
        })
      ],
      [
        newlRow({
          invoiceType: "VENDOR",
          invoiceNumber: "FCLCSH26061338-1-D1",
          shipmentFileNumber: "OI433N69"
        })
      ]
    );

    expect(rows).toHaveLength(1);
  });
});

function qboRow(input: {
  invoiceType: "CUSTOMER" | "VENDOR";
  quickBooksTxnId: string;
  quickBooksTxnNumber: string;
  shipmentFileNumber: string;
  quickBooksEntityId?: string | null;
}) {
  return {
    invoiceType: input.invoiceType,
    quickBooksTxnId: input.quickBooksTxnId,
    quickBooksTxnNumber: input.quickBooksTxnNumber,
    shipmentFileNumber: input.shipmentFileNumber,
    quickBooksEntityId: input.quickBooksEntityId ?? null
  };
}

function newlRow(input: {
  invoiceType: "CUSTOMER" | "VENDOR";
  shipmentFileNumber: string;
  invoiceNumber: string;
  quickBooksTxnId?: string | null;
  quickBooksTxnNumber?: string | null;
  quickBooksEntityId?: string | null;
}) {
  return {
    invoiceType: input.invoiceType,
    shipmentFileNumber: input.shipmentFileNumber,
    invoiceNumber: input.invoiceNumber,
    quickBooksTxnId: input.quickBooksTxnId ?? null,
    quickBooksTxnNumber: input.quickBooksTxnNumber ?? null,
    quickBooksEntityId: input.quickBooksEntityId ?? null
  };
}
