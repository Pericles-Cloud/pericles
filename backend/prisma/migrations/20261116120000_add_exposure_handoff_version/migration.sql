-- Candidate exposure hand-off counter (record_version of candidate_exposure change records)
ALTER TABLE "CandidateExposure" ADD COLUMN "handoff_version" INTEGER NOT NULL DEFAULT 0;

-- Rows that already reached Validation were handed off as record_version 1 by
-- the old candidateExposureTool. Start them at 1 so their next hand-off is v2
-- and does not collide with the existing queue row / DispatchLog entry.
UPDATE "CandidateExposure" SET "handoff_version" = 1
  WHERE "validation_status" IN ('VALIDATED', 'REJECTED');

-- Existing CANDIDATE rows may or may not have been handed off (the old tool
-- emitted v1; the old consumer emitted nothing). Mark them LEGACY_PENDING (-1):
-- the store hands them off as v2 on next evaluation, which cannot collide.
UPDATE "CandidateExposure" SET "handoff_version" = -1
  WHERE "validation_status" = 'CANDIDATE';

-- Content fingerprint last successfully back-matched for a Client Exposure Profile
ALTER TABLE "ClientExposureProfile" ADD COLUMN "back_match_fingerprint" TEXT;
ALTER TABLE "ClientExposureProfile" ADD COLUMN "back_match_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ClientExposureProfile" ADD COLUMN "back_match_attempt_fingerprint" TEXT;
