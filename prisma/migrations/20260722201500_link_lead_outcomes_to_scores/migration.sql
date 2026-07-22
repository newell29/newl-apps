-- Add a durable link from each outcome to the exact score snapshot selected
-- when the event was recorded. Existing rows are preserved and remain nullable.
ALTER TABLE "LeadOutcomeEvent"
ADD CONSTRAINT "LeadOutcomeEvent_scoreSnapshotId_fkey"
FOREIGN KEY ("scoreSnapshotId") REFERENCES "LeadScoreSnapshot"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
