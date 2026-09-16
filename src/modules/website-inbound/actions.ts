"use server";

import { ModuleKey } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AuthorizationError,
  requireModule,
  requireMutationAccess
} from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";
import {
  InboundValidationError,
  parseNote,
  parseOpportunity,
  safeReturnUrl,
  type OpportunityActionState
} from "./opportunities";
import {
  addOpportunityNote,
  createOpportunity,
  DuplicateOpportunitiesError,
  updateOpportunity
} from "./service";

async function mutationContext() {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_INBOUND);
  await requireMutationAccess(context);
  return context;
}
function fail(error: unknown): OpportunityActionState {
  if (error instanceof DuplicateOpportunitiesError)
    return { status: "duplicates", message: error.message, duplicates: error.matches };
  if (error instanceof InboundValidationError || error instanceof AuthorizationError)
    return { status: "error", message: error.message };
  return {
    status: "error",
    message: "The opportunity could not be saved. Please reload and try again."
  };
}
function idFrom(form: FormData) {
  const id = form.get("submissionId");
  if (typeof id !== "string" || !id || id.length > 100)
    throw new InboundValidationError("Missing opportunity ID.");
  return id;
}
function refresh() {
  revalidatePath("/website-inbound");
  revalidatePath("/website-growth");
}
export async function createOpportunityAction(
  _state: OpportunityActionState,
  form: FormData
): Promise<OpportunityActionState> {
  let id: string;
  try {
    const ctx = await mutationContext();
    const input = parseOpportunity(form, true);
    const creationKey = form.get("creationKey");
    if (typeof creationKey !== "string" || !/^[0-9a-f-]{36}$/i.test(creationKey))
      throw new InboundValidationError("Reopen Add opportunity and try again.");
    id = await createOpportunity(ctx, input, {
      creationKey,
      separate: form.get("separate") === "on",
      note: form.get("note") ? parseNote(form) : null
    });
    refresh();
  } catch (error) {
    return fail(error);
  }
  redirect(safeReturnUrl(form.get("returnTo"), id));
}
export async function updateOpportunityAction(
  _state: OpportunityActionState,
  form: FormData
): Promise<OpportunityActionState> {
  try {
    const ctx = await mutationContext();
    const revisionValue = form.get("revision");
    const revision = Number(revisionValue);
    if (
      typeof revisionValue !== "string" ||
      !/^\d+$/.test(revisionValue) ||
      !Number.isSafeInteger(revision)
    )
      throw new InboundValidationError("Reload the opportunity before saving.");
    const savedRevision = await updateOpportunity(
      ctx,
      idFrom(form),
      revision,
      parseOpportunity(form)
    );
    refresh();
    return { status: "success", message: "Opportunity saved.", revision: savedRevision };
  } catch (error) {
    return fail(error);
  }
}
export async function addOpportunityNoteAction(
  _state: OpportunityActionState,
  form: FormData
): Promise<OpportunityActionState> {
  try {
    const ctx = await mutationContext();
    await addOpportunityNote(ctx, idFrom(form), parseNote(form));
    refresh();
    return { status: "success", message: "Note added." };
  } catch (error) {
    return fail(error);
  }
}
