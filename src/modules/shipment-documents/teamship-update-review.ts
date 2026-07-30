import type { GarlandTeamshipReviewResponse } from "@/modules/shipment-documents/teamship-review-types";

const SAFE_TEAMSHIP_FIELD_UPDATE_KEYS = new Set([
  "po_number",
  "freight_terms",
  "carrier",
  "ship_to_name",
  "ship_to_address_1",
  "ship_to_city",
  "ship_to_state",
  "ship_to_zip",
  "shipping_instructions"
]);

/**
 * Enables only the deterministic field corrections already used by the
 * Garland email workflow. Pallet planning and editable-BOL cleanup are handled
 * separately by the Phase 2 planner.
 */
export function prepareReviewForTeamshipUpdates(
  review: GarlandTeamshipReviewResponse
): GarlandTeamshipReviewResponse {
  return {
    ...review,
    reviews: review.reviews.map((orderReview) => ({
      ...orderReview,
      fields: orderReview.fields.map((field) =>
        SAFE_TEAMSHIP_FIELD_UPDATE_KEYS.has(field.key) && field.pdfValue?.trim()
          ? { ...field, botActionEnabled: true }
          : field
      )
    }))
  };
}
