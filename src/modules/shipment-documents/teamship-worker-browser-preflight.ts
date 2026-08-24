import type { TeamshipPhase2DryRunPlan } from "@/modules/shipment-documents/teamship-phase2-dry-run";
import { TeamshipWorkerStageError } from "@/modules/shipment-documents/teamship-worker-failure";

export function requiresTeamshipBolCleanupBrowserPreflight({
  plan,
  enabled
}: {
  plan: TeamshipPhase2DryRunPlan;
  enabled: boolean;
}) {
  return (
    enabled &&
    plan.orders.some(
      (order) =>
        order.status === "READY" &&
        Boolean(order.teamshipOrderId) &&
        order.plannedBolCleanup?.removeCustomerOrderWeights === true
    )
  );
}

export async function executeTeamshipApiAfterBrowserPreflight<T>({
  required,
  preflightBrowser,
  executeApi
}: {
  required: boolean;
  preflightBrowser: () => Promise<void>;
  executeApi: () => Promise<T>;
}) {
  if (required) {
    try {
      await preflightBrowser();
    } catch (error) {
      throw new TeamshipWorkerStageError("WORKER_PREFLIGHT", error);
    }
  }

  try {
    return await executeApi();
  } catch (error) {
    throw new TeamshipWorkerStageError("TEAMSHIP_API", error);
  }
}
