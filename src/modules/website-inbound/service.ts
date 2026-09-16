import { Prisma, type WebsiteInboundSubmission } from "@prisma/client";

import { prisma } from "@/server/db";
import type { AuthenticatedContext } from "@/server/tenant-context";
import { InboundValidationError, type OpportunityInput } from "./opportunities";

export class DuplicateOpportunitiesError extends InboundValidationError {
  constructor(public matches: { id: string; label: string }[]) {
    super(
      "Possible matches found. Open an existing opportunity or confirm this is a separate enquiry."
    );
  }
}

async function validateOwner(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ownerUserId: string | null
) {
  if (
    ownerUserId &&
    !(await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: ownerUserId } },
      select: { id: true }
    }))
  ) {
    throw new InboundValidationError("Choose an owner from your organization.");
  }
}

const trackedFields = [
  "company",
  "name",
  "email",
  "phone",
  "primaryNeed",
  "source",
  "status",
  "contactChannel",
  "ownerUserId",
  "receivedOn",
  "nextAction",
  "followUpOn",
  "closedReason"
] as const;
function snapshot(record: OpportunityInput | WebsiteInboundSubmission) {
  return Object.fromEntries(
    trackedFields.map((key) => [
      key,
      record[key] instanceof Date ? (record[key] as Date).toISOString().slice(0, 10) : record[key]
    ])
  ) as Record<string, string | null>;
}

async function activity(
  tx: Prisma.TransactionClient,
  ctx: AuthenticatedContext,
  id: string,
  type: "CREATED" | "UPDATED" | "NOTE",
  body: string | null,
  changes?: Prisma.InputJsonObject
) {
  await tx.websiteInboundActivity.create({
    data: {
      tenantId: ctx.tenantId,
      submissionId: id,
      type,
      body,
      changes,
      actorUserId: ctx.userId,
      actorName: ctx.userName || ctx.userEmail
    }
  });
}

export async function createOpportunity(
  ctx: AuthenticatedContext,
  input: OpportunityInput,
  options: { creationKey: string; separate: boolean; note: string | null }
) {
  // Serializable isolation keeps concurrent entries from both passing the
  // duplicate lookup before either has committed.
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.websiteInboundSubmission.findUnique({
        where: {
          tenantId_creationKey: { tenantId: ctx.tenantId, creationKey: options.creationKey }
        }
      });
      if (existing) {
        if (existing.createdByUserId !== ctx.userId)
          throw new InboundValidationError(
            "This entry could not be saved. Reopen Add opportunity and try again."
          );
        return existing.id;
      }
      await validateOwner(tx, ctx.tenantId, input.ownerUserId);
      const or: Prisma.WebsiteInboundSubmissionWhereInput[] = [];
      if (input.email) or.push({ email: { equals: input.email, mode: "insensitive" } });
      if (input.company) or.push({ company: { equals: input.company, mode: "insensitive" } });
      if (input.phoneNormalized) or.push({ phoneNormalized: input.phoneNormalized });
      if (or.length && !options.separate) {
        const matches = await tx.websiteInboundSubmission.findMany({
          where: { tenantId: ctx.tenantId, NOT: { formType: "account_setup" }, OR: or },
          select: { id: true, company: true, name: true },
          take: 5,
          orderBy: { createdAt: "desc" }
        });
        if (matches.length)
          throw new DuplicateOpportunitiesError(
            matches.map((match) => ({
              id: match.id,
              label: match.company || match.name || "Existing opportunity"
            }))
          );
      }
      const row = await tx.websiteInboundSubmission.create({
        data: {
          ...input,
          tenantId: ctx.tenantId,
          entryMethod: "MANUAL",
          formType: "manual_enquiry",
          fields: {},
          creationKey: options.creationKey,
          createdByUserId: ctx.userId
        }
      });
      await activity(tx, ctx, row.id, "CREATED", "Opportunity added manually.");
      if (options.note) await activity(tx, ctx, row.id, "NOTE", options.note);
      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          entityType: "WebsiteInboundSubmission",
          entityId: row.id,
          action: "website_inbound.created",
          after: snapshot(row)
        }
      });
      return row.id;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function updateOpportunity(
  ctx: AuthenticatedContext,
  id: string,
  revision: number,
  input: OpportunityInput
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.websiteInboundSubmission.findFirst({
      where: { id, tenantId: ctx.tenantId, NOT: { formType: "account_setup" } }
    });
    if (!before) throw new InboundValidationError("Opportunity not found.");
    if (before.revision !== revision)
      throw new InboundValidationError(
        "Someone updated this opportunity. Reload it before saving your changes."
      );
    await validateOwner(tx, ctx.tenantId, input.ownerUserId);
    // Intake evidence is immutable. Only the current working details change.
    if (before.entryMethod === "WEBSITE_FORM" && input.contactChannel !== "WEBSITE_FORM")
      throw new InboundValidationError(
        "The original contact channel for a website submission is Website form."
      );
    if (before.entryMethod === "MANUAL" && input.contactChannel === "WEBSITE_FORM")
      throw new InboundValidationError(
        "Manual enquiries cannot be changed into website form submissions."
      );
    const oldValues = snapshot(before);
    const newValues = snapshot(input);
    const changes: Prisma.InputJsonObject = Object.fromEntries(
      trackedFields
        .filter((key) => oldValues[key] !== newValues[key])
        .map((key) => [key, { before: oldValues[key], after: newValues[key] }])
    );
    if (!Object.keys(changes).length) return before.revision;
    const result = await tx.websiteInboundSubmission.updateMany({
      where: { id, tenantId: ctx.tenantId, revision },
      data: { ...input, revision: { increment: 1 }, lastActivityAt: new Date() }
    });
    if (result.count !== 1)
      throw new InboundValidationError(
        "Someone updated this opportunity. Reload it before saving your changes."
      );
    await activity(tx, ctx, id, "UPDATED", null, changes);
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        entityType: "WebsiteInboundSubmission",
        entityId: id,
        action: "website_inbound.updated",
        before: oldValues,
        after: newValues
      }
    });
    return revision + 1;
  });
}

export async function addOpportunityNote(ctx: AuthenticatedContext, id: string, body: string) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.websiteInboundSubmission.updateMany({
      where: { id, tenantId: ctx.tenantId, NOT: { formType: "account_setup" } },
      data: { lastActivityAt: new Date() }
    });
    if (result.count !== 1) throw new InboundValidationError("Opportunity not found.");
    await activity(tx, ctx, id, "NOTE", body);
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        entityType: "WebsiteInboundSubmission",
        entityId: id,
        action: "website_inbound.note_added",
        after: { body }
      }
    });
  });
}
