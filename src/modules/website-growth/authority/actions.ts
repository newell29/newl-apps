"use server";
import { ModuleKey, PlatformRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireModule, requireMutationAccess, requireRole } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import { ScoutWorkError, text } from "../scout/model";
import { reviewAuthorityAction, saveAuthorityCampaign } from "./store";
import { reconcileAuthorityResearch, wakeAuthorityResearch } from "./scout";
async function reviewer() {
  const c = await getAuthenticatedContext();
  await requireModule(c, ModuleKey.WEBSITE_GROWTH); await requireMutationAccess(c);
  requireRole(c, [PlatformRole.ADMIN, PlatformRole.MANAGER]); return c;
}
export async function saveAuthorityCampaignAction(form: FormData): Promise<{ error: string | null }> {
  try {
    const c = await reviewer();
    await saveAuthorityCampaign(c.tenantId, c.userId, { ...Object.fromEntries(form), enabled: form.get("enabled") === "on" });
    await reconcileAuthorityResearch(c.tenantId);
    revalidatePath("/website-growth/backlinks"); revalidatePath("/website-growth/marketing");
    return { error: null };
  } catch (error) { return { error: error instanceof ScoutWorkError ? error.message : "Campaign settings could not be confirmed. Reload its saved state before retrying." }; }
}
export async function reviewAuthorityPlanAction(form: FormData): Promise<{ error: string | null }> {
  try {
    const c = await reviewer(), decision = text(form.get("decision"), "Decision", 30);
    if (decision === "APPROVE" && form.get("confirm") !== "on") throw new ScoutWorkError("Confirm this exact external action before approving it.");
    await reviewAuthorityAction(c.tenantId, c.userId, text(form.get("id"), "Action", 100), Number(form.get("revision")), decision,
      text(form.get("feedback"), "Decision or reconciliation evidence", 2000));
    if (decision === "REVISE" || decision === "RESOLVE") await wakeAuthorityResearch(c.tenantId);
    revalidatePath("/website-growth/backlinks"); revalidatePath("/website-growth/marketing"); return { error: null };
  } catch (error) { return { error: error instanceof ScoutWorkError ? error.message : "Decision could not be confirmed. Reload the saved action before trying again." }; }
}
