CREATE TABLE "CodexReviewRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "developmentSuggestionId" TEXT NOT NULL,
    "developmentJobId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "ticketCoverage" JSONB NOT NULL,
    "checks" JSONB NOT NULL,
    "tests" JSONB NOT NULL,
    "businessQuestions" JSONB NOT NULL,
    "reviewerModel" TEXT NOT NULL,
    "reviewerReasoningEffort" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodexReviewRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodexReviewRun_tenantId_id_key"
ON "CodexReviewRun"("tenantId", "id");

CREATE UNIQUE INDEX "CodexReviewRun_tenantId_developmentJobId_commitSha_attempt_key"
ON "CodexReviewRun"("tenantId", "developmentJobId", "commitSha", "attempt");

CREATE INDEX "CodexReviewRun_tenantId_developmentSuggestionId_createdAt_idx"
ON "CodexReviewRun"("tenantId", "developmentSuggestionId", "createdAt");

CREATE INDEX "CodexReviewRun_tenantId_verdict_createdAt_idx"
ON "CodexReviewRun"("tenantId", "verdict", "createdAt");

ALTER TABLE "CodexReviewRun"
ADD CONSTRAINT "CodexReviewRun_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodexReviewRun"
ADD CONSTRAINT "CodexReviewRun_tenantId_developmentSuggestionId_fkey"
FOREIGN KEY ("tenantId", "developmentSuggestionId")
REFERENCES "DevelopmentSuggestion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodexReviewRun"
ADD CONSTRAINT "CodexReviewRun_tenantId_developmentJobId_fkey"
FOREIGN KEY ("tenantId", "developmentJobId")
REFERENCES "AutomationJobRun"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
