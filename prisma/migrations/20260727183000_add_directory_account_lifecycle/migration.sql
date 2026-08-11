-- Directory credentials remain outside the database. These fields store only
-- an opaque derivation reference, its version, and the safe account lifecycle.
CREATE TYPE "WebsiteGrowthDirectoryAccountState" AS ENUM (
  'NOT_REQUIRED',
  'NEEDS_ACCOUNT',
  'CREDENTIAL_READY',
  'EMAIL_VERIFICATION_PENDING',
  'HUMAN_ACTION_REQUIRED',
  'ACTIVE',
  'FAILED'
);

CREATE TYPE "WebsiteGrowthDirectoryChallengeType" AS ENUM (
  'CAPTCHA',
  'MFA',
  'PHONE_VERIFICATION',
  'EMAIL_VERIFICATION',
  'PASSWORD_POLICY',
  'TERMS',
  'OTHER'
);

ALTER TABLE "WebsiteGrowthBacklinkOpportunity"
  ADD COLUMN "directoryCredentialRef" TEXT,
  ADD COLUMN "directoryCredentialVersion" INTEGER,
  ADD COLUMN "directoryAccountState" "WebsiteGrowthDirectoryAccountState" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "directoryAccountRequestedAt" TIMESTAMP(3),
  ADD COLUMN "directoryAccountVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "directoryChallengeType" "WebsiteGrowthDirectoryChallengeType",
  ADD COLUMN "directoryChallengeDetail" TEXT,
  ADD COLUMN "directoryChallengeAt" TIMESTAMP(3);

UPDATE "WebsiteGrowthBacklinkOpportunity"
SET "directoryAccountState" = CASE
  WHEN "category" <> 'DIRECTORY_CITATION' THEN 'NOT_REQUIRED'::"WebsiteGrowthDirectoryAccountState"
  WHEN "liveUrl" IS NOT NULL THEN 'ACTIVE'::"WebsiteGrowthDirectoryAccountState"
  WHEN "submittedAt" IS NOT NULL THEN 'EMAIL_VERIFICATION_PENDING'::"WebsiteGrowthDirectoryAccountState"
  ELSE 'NEEDS_ACCOUNT'::"WebsiteGrowthDirectoryAccountState"
END;

CREATE INDEX "WebsiteGrowthBacklinkOpportunity_tenantId_directoryAccountState_idx"
  ON "WebsiteGrowthBacklinkOpportunity"("tenantId", "directoryAccountState");
