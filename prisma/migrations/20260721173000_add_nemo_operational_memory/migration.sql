-- Durable workflow artifacts keep Teams uploads tenant-scoped and below the
-- Vercel request-size ceiling by storing the payload in independently hashed chunks.
CREATE TABLE "WorkflowArtifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "sourceChannel" TEXT NOT NULL,
    "sourceIdempotencyKey" TEXT,
    "externalMessageId" TEXT,
    "externalConversationId" TEXT,
    "submittedByUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "chunkCount" INTEGER NOT NULL,
    "teamshipReviewRunId" TEXT,
    "duplicateOfArtifactId" TEXT,
    "extractionSummary" JSONB,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowArtifactChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowArtifactChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleKey" "ModuleKey" NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "teamshipReviewRunId" TEXT,
    "teamshipReviewOrderId" TEXT,
    "artifactId" TEXT,
    "reporterUserId" TEXT NOT NULL,
    "reporterStatement" TEXT NOT NULL,
    "expectedOutcome" TEXT,
    "observedOutcome" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "evidence" JSONB,
    "resolutionNotes" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovedOperationalLesson" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleKey" "ModuleKey" NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "classification" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ruleText" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceFeedbackId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredByUserId" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovedOperationalLesson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DevelopmentSuggestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleKey" "ModuleKey" NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "sourceFeedbackIds" JSONB NOT NULL,
    "feedbackCount" INTEGER NOT NULL,
    "proposedScope" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionByUserId" TEXT,
    "decisionAt" TIMESTAMP(3),
    "decisionNotes" TEXT,
    "developmentThreadId" TEXT,
    "pullRequestUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevelopmentSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowArtifact_tenantId_id_key" ON "WorkflowArtifact"("tenantId", "id");
CREATE UNIQUE INDEX "WorkflowArtifact_tenantId_sourceIdempotencyKey_key" ON "WorkflowArtifact"("tenantId", "sourceIdempotencyKey");
CREATE INDEX "WorkflowArtifact_tenantId_workflowKey_createdAt_idx" ON "WorkflowArtifact"("tenantId", "workflowKey", "createdAt");
CREATE INDEX "WorkflowArtifact_tenantId_contentHash_idx" ON "WorkflowArtifact"("tenantId", "contentHash");
CREATE INDEX "WorkflowArtifact_tenantId_externalMessageId_idx" ON "WorkflowArtifact"("tenantId", "externalMessageId");
CREATE INDEX "WorkflowArtifact_tenantId_status_updatedAt_idx" ON "WorkflowArtifact"("tenantId", "status", "updatedAt");
CREATE UNIQUE INDEX "WorkflowArtifactChunk_tenantId_artifactId_chunkIndex_key" ON "WorkflowArtifactChunk"("tenantId", "artifactId", "chunkIndex");
CREATE INDEX "WorkflowArtifactChunk_tenantId_artifactId_idx" ON "WorkflowArtifactChunk"("tenantId", "artifactId");
CREATE UNIQUE INDEX "OperationalFeedback_tenantId_id_key" ON "OperationalFeedback"("tenantId", "id");
CREATE INDEX "OperationalFeedback_tenantId_workflowKey_status_createdAt_idx" ON "OperationalFeedback"("tenantId", "workflowKey", "status", "createdAt");
CREATE INDEX "OperationalFeedback_tenantId_subjectType_subjectId_idx" ON "OperationalFeedback"("tenantId", "subjectType", "subjectId");
CREATE INDEX "OperationalFeedback_tenantId_reporterUserId_createdAt_idx" ON "OperationalFeedback"("tenantId", "reporterUserId", "createdAt");
CREATE UNIQUE INDEX "ApprovedOperationalLesson_tenantId_id_key" ON "ApprovedOperationalLesson"("tenantId", "id");
CREATE UNIQUE INDEX "ApprovedOperationalLesson_tenantId_sourceFeedbackId_key" ON "ApprovedOperationalLesson"("tenantId", "sourceFeedbackId");
CREATE INDEX "ApprovedOperationalLesson_tenantId_workflowKey_status_updatedAt_idx" ON "ApprovedOperationalLesson"("tenantId", "workflowKey", "status", "updatedAt");
CREATE INDEX "ApprovedOperationalLesson_tenantId_subjectType_subjectId_status_idx" ON "ApprovedOperationalLesson"("tenantId", "subjectType", "subjectId", "status");
CREATE UNIQUE INDEX "DevelopmentSuggestion_tenantId_id_key" ON "DevelopmentSuggestion"("tenantId", "id");
CREATE INDEX "DevelopmentSuggestion_tenantId_status_generatedAt_idx" ON "DevelopmentSuggestion"("tenantId", "status", "generatedAt");
CREATE INDEX "DevelopmentSuggestion_tenantId_workflowKey_generatedAt_idx" ON "DevelopmentSuggestion"("tenantId", "workflowKey", "generatedAt");

ALTER TABLE "WorkflowArtifact" ADD CONSTRAINT "WorkflowArtifact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowArtifactChunk" ADD CONSTRAINT "WorkflowArtifactChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowArtifactChunk" ADD CONSTRAINT "WorkflowArtifactChunk_tenantId_artifactId_fkey" FOREIGN KEY ("tenantId", "artifactId") REFERENCES "WorkflowArtifact"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalFeedback" ADD CONSTRAINT "OperationalFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovedOperationalLesson" ADD CONSTRAINT "ApprovedOperationalLesson_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevelopmentSuggestion" ADD CONSTRAINT "DevelopmentSuggestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
