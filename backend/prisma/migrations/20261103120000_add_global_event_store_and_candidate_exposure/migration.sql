-- CreateEnum
CREATE TYPE "GlobalEventStatus" AS ENUM ('FORECAST', 'DEVELOPING', 'ACTIVE', 'DE_ESCALATING', 'RESOLVED', 'RETRACTED', 'MERGED');

-- CreateEnum
CREATE TYPE "ExposureValidationStatus" AS ENUM ('WATCHING', 'CANDIDATE', 'VALIDATED', 'REJECTED', 'CLEARED');

-- CreateTable
CREATE TABLE "GlobalEvent" (
    "id" TEXT NOT NULL,
    "event_hash" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "actor" TEXT,
    "action" TEXT,
    "target" TEXT,
    "occurred_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "forecast_at" TIMESTAMP(3),
    "first_reported_at" TIMESTAMP(3),
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "secondary_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "GlobalEventStatus" NOT NULL DEFAULT 'FORECAST',
    "resolved_at" TIMESTAMP(3),
    "resolution_basis" TEXT,
    "intrinsic_severity" TEXT NOT NULL,
    "severity_rationale" TEXT,
    "confidence" TEXT NOT NULL,
    "corroborating_source_count" INTEGER NOT NULL DEFAULT 0,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "affected_area" JSONB,
    "country_iso" TEXT,
    "admin1_region" TEXT,
    "named_infrastructure" JSONB,
    "affected_dimensions" JSONB,
    "expected_duration" JSONB,
    "duration_estimate" JSONB,
    "event_statement" TEXT,
    "parent_event_id" TEXT,
    "related_event_ids" JSONB NOT NULL DEFAULT '[]',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "context_items" JSONB NOT NULL DEFAULT '[]',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "last_checked_at" TIMESTAMP(3),
    "next_check_due" TIMESTAMP(3),
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "verification_ref" TEXT,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateExposure" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "global_event_id" TEXT NOT NULL,
    "global_event_hash" TEXT NOT NULL,
    "exposure_pathways" JSONB NOT NULL,
    "exposure_strength" TEXT NOT NULL,
    "exposed_assets" JSONB NOT NULL,
    "match_confidence" JSONB NOT NULL,
    "temporal_relevance" JSONB,
    "strategic_context" JSONB,
    "rationale" TEXT NOT NULL,
    "exposure_priority" TEXT NOT NULL,
    "validation_status" "ExposureValidationStatus" NOT NULL DEFAULT 'WATCHING',
    "validation_ref" TEXT,
    "cleared_at" TIMESTAMP(3),
    "cleared_reason" TEXT,
    "profile_snapshot_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateExposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientExposureProfile" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "own_facilities" JSONB NOT NULL DEFAULT '[]',
    "suppliers" JSONB NOT NULL DEFAULT '[]',
    "products" JSONB NOT NULL DEFAULT '[]',
    "logistics" JSONB NOT NULL DEFAULT '[]',
    "shipments_in_transit" JSONB NOT NULL DEFAULT '[]',
    "customers" JSONB NOT NULL DEFAULT '[]',
    "strategic_priorities" JSONB,
    "key_account_commitments" JSONB,
    "stated_concerns" JSONB,
    "past_events" JSONB,
    "sensitivity_config" JSONB,
    "excluded_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excluded_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buffer_distances" JSONB,
    "min_severity" JSONB,
    "last_erp_sync" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_shipment_sync" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_org_memory_sync" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profile_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientExposureProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalEvent_event_hash_key" ON "GlobalEvent"("event_hash");

-- CreateIndex
CREATE INDEX "GlobalEvent_status_idx" ON "GlobalEvent"("status");

-- CreateIndex
CREATE INDEX "GlobalEvent_intrinsic_severity_idx" ON "GlobalEvent"("intrinsic_severity");

-- CreateIndex
CREATE INDEX "GlobalEvent_occurred_at_idx" ON "GlobalEvent"("occurred_at");

-- CreateIndex
CREATE INDEX "GlobalEvent_category_idx" ON "GlobalEvent"("category");

-- CreateIndex
CREATE INDEX "GlobalEvent_latitude_longitude_idx" ON "GlobalEvent"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "GlobalEvent_next_check_due_idx" ON "GlobalEvent"("next_check_due");

-- CreateIndex
CREATE INDEX "GlobalEvent_first_detected_at_idx" ON "GlobalEvent"("first_detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateExposure_organization_id_global_event_hash_key" ON "CandidateExposure"("organization_id", "global_event_hash");

-- CreateIndex
CREATE INDEX "CandidateExposure_organization_id_validation_status_idx" ON "CandidateExposure"("organization_id", "validation_status");

-- CreateIndex
CREATE INDEX "CandidateExposure_global_event_id_idx" ON "CandidateExposure"("global_event_id");

-- CreateIndex
CREATE INDEX "CandidateExposure_exposure_strength_idx" ON "CandidateExposure"("exposure_strength");

-- CreateIndex
CREATE INDEX "CandidateExposure_exposure_priority_idx" ON "CandidateExposure"("exposure_priority");

-- CreateIndex
CREATE INDEX "CandidateExposure_created_at_idx" ON "CandidateExposure"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ClientExposureProfile_organization_id_key" ON "ClientExposureProfile"("organization_id");

-- CreateIndex
CREATE INDEX "ClientExposureProfile_organization_id_idx" ON "ClientExposureProfile"("organization_id");

-- CreateIndex
CREATE INDEX "ClientExposureProfile_profile_version_idx" ON "ClientExposureProfile"("profile_version");

-- AddForeignKey
ALTER TABLE "CandidateExposure" ADD CONSTRAINT "CandidateExposure_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientExposureProfile" ADD CONSTRAINT "ClientExposureProfile_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
