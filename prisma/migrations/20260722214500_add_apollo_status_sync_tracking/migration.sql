-- Track scheduled Apollo status refreshes per contact without rewriting existing data.
ALTER TABLE "Contact"
  ADD COLUMN "apolloLastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "apolloNextSyncAt" TIMESTAMP(3),
  ADD COLUMN "apolloSyncFailureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "apolloSyncLastError" TEXT;

CREATE INDEX "Contact_tenantId_apolloNextSyncAt_idx"
  ON "Contact"("tenantId", "apolloNextSyncAt");

CREATE INDEX "Contact_tenantId_apolloSyncFailureCount_idx"
  ON "Contact"("tenantId", "apolloSyncFailureCount");
