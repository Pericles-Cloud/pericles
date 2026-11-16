-- Candidate exposure hand-off counter: the record_version of the row's
-- candidate_exposure change records (small and monotonic; DispatchLog
-- record_version is INTEGER).
ALTER TABLE "CandidateExposure" ADD COLUMN "handoff_version" INTEGER NOT NULL DEFAULT 0;

-- Rows other than CANDIDATE may have been handed off as record_version 1 by the
-- old candidateExposureTool (including rows later moved to WATCHING). Start
-- them at 1 so their next hand-off is v2 and cannot collide with an existing
-- queue row / DispatchLog entry. Versions need not be contiguous.
UPDATE "CandidateExposure" SET "handoff_version" = 1
  WHERE "validation_status" IN ('WATCHING', 'VALIDATED', 'REJECTED', 'CLEARED');

-- Existing CANDIDATE rows may or may not have been handed off (the old tool
-- emitted v1; the old consumer emitted nothing). Mark them LEGACY_PENDING (-1):
-- the store hands them off as v2 on next evaluation, which cannot collide.
UPDATE "CandidateExposure" SET "handoff_version" = -1
  WHERE "validation_status" = 'CANDIDATE';
