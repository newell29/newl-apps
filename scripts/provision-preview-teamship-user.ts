import { PlatformRole, PrismaClient } from "@prisma/client";

import { readPreviewTeamshipUserProvisioningConfig } from "@/server/auth/preview-teamship-user-provisioning";

const prisma = new PrismaClient();

async function main() {
  const config = readPreviewTeamshipUserProvisioningConfig(process.env);
  if (!config) {
    console.log("Preview Teamship user provisioning is not configured; skipping.");
    return;
  }

  const [tenant, identityOwner] = await Promise.all([
    prisma.tenant.findUnique({ where: { slug: "newl-group" }, select: { id: true } }),
    prisma.user.findFirst({
      where: {
        microsoftEntraTenantId: config.tenantId,
        microsoftEntraObjectId: config.objectId
      },
      select: { email: true }
    })
  ]);
  if (!tenant) {
    throw new Error("The Preview newl-group tenant is not provisioned.");
  }
  if (identityOwner && identityOwner.email.toLowerCase() !== config.email) {
    throw new Error("The configured Preview Microsoft identity is already linked to another user.");
  }

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.upsert({
      where: { email: config.email },
      update: {
        name: config.name,
        microsoftEntraTenantId: config.tenantId,
        microsoftEntraObjectId: config.objectId
      },
      create: {
        email: config.email,
        name: config.name,
        microsoftEntraTenantId: config.tenantId,
        microsoftEntraObjectId: config.objectId
      }
    });

    await transaction.membership.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id
        }
      },
      update: {},
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: PlatformRole.READ_ONLY
      }
    });
  });

  console.log("Provisioned the configured Preview Teamship user and Microsoft Teams identity.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
