"use server";

import { ModuleKey, WebsiteInboundStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { prisma } from "@/server/db";
import { requireModule, requireMutationAccess } from "@/server/auth/authorization";
import { getAuthenticatedContext } from "@/server/tenant-context";

function parseWebsiteInboundStatus(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !(value in WebsiteInboundStatus)) {
    throw new Error("Invalid website inbound status.");
  }

  return value as WebsiteInboundStatus;
}

export async function updateWebsiteInboundStatusAction(formData: FormData) {
  const context = await getAuthenticatedContext();
  await requireModule(context, ModuleKey.WEBSITE_INBOUND);
  await requireMutationAccess(context);

  const submissionId = formData.get("submissionId");

  if (typeof submissionId !== "string" || !submissionId) {
    throw new Error("Missing website inbound submission ID.");
  }

  const result = await prisma.websiteInboundSubmission.updateMany({
    where: {
      id: submissionId,
      tenantId: context.tenantId
    },
    data: {
      status: parseWebsiteInboundStatus(formData.get("status"))
    }
  });

  if (result.count === 0) {
    throw new Error("Website inbound submission was not found or could not be updated.");
  }

  revalidatePath("/website-inbound");
}
