"use server";

import { ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { proposeScoutPage, reconcileScoutWork, reviewScoutWork, saveScoutMission } from "./store";
import { text } from "./model";
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
    qualifiedLead: form.get("qualifiedLead"), dailySteps: Number(form.get("dailySteps")), maxActive: Number(form.get("maxActive")), enabled: form.get("enabled") === "on" });
  revalidatePath("/website-growth");
  revalidatePath("/website-growth/marketing");
}
export async function refreshScoutWorkAction() {
  const context = await reviewer();
  await reconcileScoutWork(context.tenantId);
  revalidatePath("/website-growth");
  revalidatePath("/website-growth/marketing");
}
export async function reviewScoutWorkAction(form: FormData) {
  const context = await reviewer();
  await reviewScoutWork(context.tenantId, context.userId, text(form.get("id"), "Work ID", 100), Number(form.get("revision")),
    text(form.get("decision"), "Decision", 50), text(form.get("feedback"), "Feedback", 2000));
  revalidatePath("/website-growth");
  revalidatePath("/website-growth/marketing");
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
