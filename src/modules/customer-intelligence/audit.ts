import { Prisma } from "@prisma/client";

import { prisma } from "@/server/db";

export type AuditActor = {
  tenantId: string;
  userId: string | null;
};

export function auditEntry(input: {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  const { actor, action, entityType, entityId, before, after } = input;
  return prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      entityType,
      entityId: entityId ?? null,
      before: before === undefined ? Prisma.JsonNull : (before as Prisma.InputJsonValue),
      after: after === undefined ? Prisma.JsonNull : (after as Prisma.InputJsonValue)
    }
  });
}
