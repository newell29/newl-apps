"use server";

import { ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { proposeScoutPage, reconcileScoutWork, reviewScoutWork, saveScoutMission } from "./store";
import { ScoutWorkError, text } from "./model";
import { refreshSiteReview } from "./effectiveness";
import { approveAndSendScoutReply } from "./reply";

async function reviewer() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_GROWTH);
  await requireMutationAccess(context);
  requireRole(context, [PlatformRole.ADMIN, PlatformRole.MANAGER]);
  return context;
}
export async function saveScoutMissionAction(form: FormData) {
  const context = await reviewer();
  await saveScoutMission(context.tenantId, context.userId, { objective: form.get("objective"), priorities: form.get("priorities"),
    qualifiedLead: form.get("qualifiedLead"), successCriteria: form.get("successCriteria"), competitorWatchlist: form.get("competitorWatchlist"),
    dailySteps: Number(form.get("dailySteps")), maxActive: Number(form.get("maxActive")), enabled: form.get("enabled") === "on" });
  revalidatePath("/website-growth");
  revalidatePath("/website-growth/marketing");
}
export async function refreshScoutWorkAction() {
  const context = await reviewer();
  await reconcileScoutWork(context.tenantId);
  revalidatePath("/website-growth");
  revalidatePath("/website-growth/marketing");
}
export async function reviewScoutWorkAction(form: FormData): Promise<{ error: string | null }> {
  try {
    const context = await reviewer();
    await reviewScoutWork(context.tenantId, context.userId, text(form.get("id"), "Work ID", 100), Number(form.get("revision")),
      text(form.get("decision"), "Decision", 50), text(form.get("feedback"), "Feedback", 2000));
    revalidatePath("/website-growth");
    revalidatePath("/website-growth/marketing");
    return { error: null };
  } catch (error) {
    return { error: error instanceof ScoutWorkError ? error.message : "Scout could not confirm this decision. Reload the workboard and check its saved state before trying again." };
  }
}
export async function proposeScoutPageAction(form: FormData) {
  const context = await reviewer();
  await proposeScoutPage(context.tenantId, context.userId, { title: form.get("title"), hypothesis: form.get("hypothesis"), route: form.get("route"), newPage: form.get("newPage") === "on" });
  revalidatePath("/website-growth");
  revalidatePath("/website-growth/marketing");
}
export async function sendScoutReplyAction(form: FormData) {
  const context = await reviewer();
  if (form.get("confirmSend") !== "on") throw new Error("Confirm sending this exact response before continuing.");
  await approveAndSendScoutReply(context.tenantId, context.userId, text(form.get("id"), "Work ID", 100), Number(form.get("revision")));
  revalidatePath("/website-growth");
  revalidatePath("/website-growth/marketing");
}

export async function refreshScoutEffectivenessAction(): Promise<{ error: string | null }> {
  try {
    const context = await reviewer();
    await refreshSiteReview(context.tenantId);
    await reconcileScoutWork(context.tenantId);
    revalidatePath("/website-growth");
    revalidatePath("/website-growth/effectiveness");
    return { error: null };
  } catch {
    return { error: "The review could not be refreshed. Saved evidence is preserved; the next worker wake can retry. Existing work remains available." };
  }
}
