-- Candidate exposure hand-off counter (record_version of candidate_exposure change records)
ALTER TABLE "CandidateExposure" ADD COLUMN "handoff_version" INTEGER NOT NULL DEFAULT 0;

-- Content fingerprint last successfully back-matched for a Client Exposure Profile
ALTER TABLE "ClientExposureProfile" ADD COLUMN "back_match_fingerprint" TEXT;
