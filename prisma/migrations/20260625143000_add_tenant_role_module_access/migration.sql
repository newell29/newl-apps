-- CreateTable
CREATE TABLE "TenantRolePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "canMutate" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantRolePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantRolePolicy_tenantId_role_key" ON "TenantRolePolicy"("tenantId", "role");

-- CreateIndex
CREATE INDEX "TenantRolePolicy_tenantId_canMutate_idx" ON "TenantRolePolicy"("tenantId", "canMutate");

-- AddForeignKey
ALTER TABLE "TenantRolePolicy" ADD CONSTRAINT "TenantRolePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TenantRoleModuleAccess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantRoleModuleAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantRoleModuleAccess_tenantId_role_moduleId_key" ON "TenantRoleModuleAccess"("tenantId", "role", "moduleId");

-- CreateIndex
CREATE INDEX "TenantRoleModuleAccess_tenantId_role_enabled_idx" ON "TenantRoleModuleAccess"("tenantId", "role", "enabled");

-- CreateIndex
CREATE INDEX "TenantRoleModuleAccess_tenantId_moduleId_idx" ON "TenantRoleModuleAccess"("tenantId", "moduleId");

-- AddForeignKey
ALTER TABLE "TenantRoleModuleAccess" ADD CONSTRAINT "TenantRoleModuleAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantRoleModuleAccess" ADD CONSTRAINT "TenantRoleModuleAccess_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
