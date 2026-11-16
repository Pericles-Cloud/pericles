-- Candidate exposure hand-off counter (record_version of candidate_exposure change records)
ALTER TABLE "CandidateExposure" ADD COLUMN "handoff_version" INTEGER NOT NULL DEFAULT 0;

-- Rows that already reached Validation were handed off as record_version 1 by
-- candidateExposureTool. Start them at 1 so their next hand-off is v2 and does
-- not collide with the existing queue row / DispatchLog entry. CANDIDATE rows
-- stay at 0: some were never handed off, and the store emits v1 for them on
-- next evaluation (a no-op if v1 was already queued).
UPDATE "CandidateExposure" SET "handoff_version" = 1
  WHERE "validation_status" IN ('VALIDATED', 'REJECTED');

-- Content fingerprint last successfully back-matched for a Client Exposure Profile
ALTER TABLE "ClientExposureProfile" ADD COLUMN "back_match_fingerprint" TEXT;
