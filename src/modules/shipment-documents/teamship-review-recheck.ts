import { getGarlandLearnedProductDimensionRecommendations } from "@/modules/shipment-documents/garland-product-dimension-directory";
import { collectGarlandProductDimensionSkus } from "@/modules/shipment-documents/garland-product-dimensions";
import { buildGarlandTeamshipReview } from "@/modules/shipment-documents/teamship-review";
import {
  getTeamshipReviewRunWorkspace,
  reconcileRecheckedTeamshipReviewWorkflowStatuses,
  updateTeamshipReviewRunReview
} from "@/modules/shipment-documents/teamship-review-history";
import { prepareReviewForTeamshipUpdates } from "@/modules/shipment-documents/teamship-update-review";
import { fetchTeamshipShippingOrdersForReview } from "@/server/integrations/teamship";
import type { AuthenticatedContext } from "@/server/tenant-context";

export async function recheckCompletelyMissingTeamshipReviewRun(
  context: AuthenticatedContext,
  runId: string
) {
  const workspace = await getTeamshipReviewRunWorkspace(context, runId);
  const { review } = workspace;

  if (!isCompletelyMissingSavedReview(review)) {
    throw new Error("Teamship recheck is limited to saved batches where every PDF order was missed.");
  }

  const teamshipOrders = await fetchTeamshipShippingOrdersForReview({
    tenantId: context.tenantId,
    shipmentDate: workspace.shipmentDate,
    includeCompletedArchive: true,
    orderReferences: review.pdfOrders.map((order) => ({
      psNumber: order.psNumber,
      srNumber: order.srNumber
    }))
  });
  const learnedProductDimensions = await getGarlandLearnedProductDimensionRecommendations({
    tenantId: context.tenantId,
    skus: collectGarlandProductDimensionSkus({
      pdfOrders: review.pdfOrders,
      teamshipOrders
    })
  });
  const refreshedReview = prepareReviewForTeamshipUpdates(
    buildGarlandTeamshipReview(review.pdfOrders, teamshipOrders, review.teamshipAlerts, {
      learnedProductDimensions
    })
  );

  await updateTeamshipReviewRunReview({
    context,
    runId,
    review: refreshedReview
  });
  await reconcileRecheckedTeamshipReviewWorkflowStatuses({
    context,
    runId,
    review: refreshedReview
  });

  return refreshedReview;
}

function isCompletelyMissingSavedReview(review: {
  summary: {
    pdfOrderCount: number;
    missingTeamshipCount: number;
    teamshipMatchedCount: number;
  };
}) {
  return (
    review.summary.pdfOrderCount > 0 &&
    review.summary.missingTeamshipCount === review.summary.pdfOrderCount &&
    review.summary.teamshipMatchedCount === 0
  );
}
