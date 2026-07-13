import type {
  GarlandPdfShippingOrder,
  GarlandTeamshipReviewResponse
} from "@/modules/shipment-documents/teamship-review-types";

export type GarlandTeamshipPalletDraftLine = {
  sku: string;
  serialNumbers: string[];
};

export function addPalletDraftLineToReviewState({
  orders,
  review,
  srNumber,
  line
}: {
  orders: GarlandPdfShippingOrder[];
  review: GarlandTeamshipReviewResponse | null;
  srNumber: string;
  line: GarlandTeamshipPalletDraftLine;
}) {
  const normalizedSrNumber = normalizeIdentifier(srNumber);
  const normalizedSku = normalizeIdentifier(line.sku);

  if (!normalizedSrNumber || !normalizedSku) {
    return { orders, review };
  }

  const nextItem = {
    lineNumber: null,
    sku: line.sku.trim().toUpperCase(),
    description: "CSR-added Teamship pallet line",
    quantity: 1,
    dueShipDate: null,
    serialNumbers: line.serialNumbers
  };
  const nextReviewItem = {
    sku: nextItem.sku,
    quantity: "1",
    serialNumbers: nextItem.serialNumbers
  };
  const nextOrders = orders.map((order) =>
    normalizeIdentifier(order.srNumber) === normalizedSrNumber
      ? {
          ...order,
          items: [...order.items, nextItem]
        }
      : order
  );

  if (!review) {
    return { orders: nextOrders, review };
  }

  return {
    orders: nextOrders,
    review: {
      ...review,
      pdfOrders: review.pdfOrders.map((order) =>
        normalizeIdentifier(order.srNumber) === normalizedSrNumber
          ? {
              ...order,
              items: [...order.items, nextItem]
            }
          : order
      ),
      reviews: review.reviews.map((orderReview) => {
        if (normalizeIdentifier(orderReview.srNumber) !== normalizedSrNumber) {
          return orderReview;
        }

        const hasDimension = orderReview.productDimensions.some((dimension) => normalizeIdentifier(dimension.sku) === normalizedSku);

        return {
          ...orderReview,
          pdfItems: [...orderReview.pdfItems, nextReviewItem],
          productDimensions: hasDimension
            ? orderReview.productDimensions
            : [
                ...orderReview.productDimensions,
                {
                  sku: nextItem.sku,
                  source: "CSR_OVERRIDE" as const,
                  productType: null,
                  quantity: 1,
                  lengthIn: null,
                  widthIn: null,
                  heightIn: null,
                  weightLb: null,
                  weightUnit: "lbs",
                  confidence: "LOW" as const,
                  note: "CSR-added pallet line. Enter dimensions if available; SKU/SN commodity text still goes to the bot draft."
                }
              ]
        };
      })
    }
  };
}

export function removePalletDraftLineFromReviewState({
  orders,
  review,
  srNumber,
  itemIndex
}: {
  orders: GarlandPdfShippingOrder[];
  review: GarlandTeamshipReviewResponse | null;
  srNumber: string;
  itemIndex: number;
}) {
  const normalizedSrNumber = normalizeIdentifier(srNumber);

  if (!normalizedSrNumber || itemIndex < 0) {
    return { orders, review };
  }

  const nextOrders = orders.map((order) =>
    normalizeIdentifier(order.srNumber) === normalizedSrNumber
      ? {
          ...order,
          items: order.items.filter((_, index) => index !== itemIndex)
        }
      : order
  );

  if (!review) {
    return { orders: nextOrders, review };
  }

  return {
    orders: nextOrders,
    review: {
      ...review,
      pdfOrders: review.pdfOrders.map((order) =>
        normalizeIdentifier(order.srNumber) === normalizedSrNumber
          ? {
              ...order,
              items: order.items.filter((_, index) => index !== itemIndex)
            }
          : order
      ),
      reviews: review.reviews.map((orderReview) =>
        normalizeIdentifier(orderReview.srNumber) === normalizedSrNumber
          ? {
              ...orderReview,
              pdfItems: orderReview.pdfItems.filter((_, index) => index !== itemIndex)
            }
          : orderReview
      )
    }
  };
}

export function updatePalletCommodityOverrideInReviewState({
  orders,
  review,
  srNumber,
  itemIndex,
  value
}: {
  orders: GarlandPdfShippingOrder[];
  review: GarlandTeamshipReviewResponse | null;
  srNumber: string;
  itemIndex: number;
  value: string;
}) {
  const normalizedSrNumber = normalizeIdentifier(srNumber);
  const nextValue = value.trim().length > 0 ? value : null;

  if (!normalizedSrNumber || itemIndex < 0) {
    return { orders, review };
  }

  const updateOrder = (order: GarlandPdfShippingOrder) =>
    normalizeIdentifier(order.srNumber) === normalizedSrNumber
      ? {
          ...order,
          items: order.items.map((item, index) =>
            index === itemIndex
              ? {
                  ...item,
                  commodityOverride: nextValue
                }
              : item
          )
        }
      : order;

  const nextOrders = orders.map(updateOrder);

  if (!review) {
    return { orders: nextOrders, review };
  }

  return {
    orders: nextOrders,
    review: {
      ...review,
      pdfOrders: review.pdfOrders.map(updateOrder)
    }
  };
}

export function updateReviewFieldProposedValueInReviewState({
  review,
  srNumber,
  fieldKey,
  value
}: {
  review: GarlandTeamshipReviewResponse | null;
  srNumber: string;
  fieldKey: string;
  value: string;
}) {
  const normalizedSrNumber = normalizeIdentifier(srNumber);
  const normalizedFieldKey = normalizeIdentifier(fieldKey);

  if (!review || !normalizedSrNumber || !normalizedFieldKey) {
    return review;
  }

  const nextValue = value.trim().length > 0 ? value : null;

  return {
    ...review,
    reviews: review.reviews.map((orderReview) =>
      normalizeIdentifier(orderReview.srNumber) === normalizedSrNumber
        ? {
            ...orderReview,
            fields: orderReview.fields.map((field) =>
              normalizeIdentifier(field.key) === normalizedFieldKey
                ? {
                    ...field,
                    proposedValue: nextValue
                  }
                : field
            )
          }
        : orderReview
    )
  };
}

function normalizeIdentifier(value: string | null) {
  return value?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? "";
}
