-- Capture the stable Microsoft Entra tenant/object pair from a successful
-- Newl Apps SSO login. OpenClaw's Teams tool uses this pair to resolve the
-- authenticated sender to the existing User and Membership server-side.
ALTER TABLE "User"
ADD COLUMN "microsoftEntraTenantId" TEXT,
ADD COLUMN "microsoftEntraObjectId" TEXT;

CREATE UNIQUE INDEX "User_microsoftEntraTenantId_microsoftEntraObjectId_key"
ON "User"("microsoftEntraTenantId", "microsoftEntraObjectId");
