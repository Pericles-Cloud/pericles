-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email_domain" TEXT,
    "is_root" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationContext" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plants" JSONB NOT NULL,
    "warehouses" JSONB NOT NULL,
    "suppliers" JSONB NOT NULL,
    "shipping_lanes" JSONB NOT NULL,
    "monitored_risk_types" TEXT[],
    "geographic_radius_km" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "severity_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "strategic_documents" JSONB,
    "last_erp_sync" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_hash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location_name" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_timestamp" TIMESTAMP(3) NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "risk_factors" TEXT[],
    "affected_domains" TEXT[],
    "validation_status" TEXT NOT NULL DEFAULT 'pending',
    "validated_at" TIMESTAMP(3),
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "incident_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL,
    "assigned_to" TEXT,
    "assigned_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "estimated_impact" DOUBLE PRECISION,
    "actual_impact" DOUBLE PRECISION,
    "impact_calculated_at" TIMESTAMP(3),
    "response_plan_id" TEXT,
    "notifications_sent" INTEGER NOT NULL DEFAULT 0,
    "confirming_sources" TEXT[],
    "validation_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "severity_score" DOUBLE PRECISION NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "risk_category" TEXT NOT NULL,
    "risk_type" TEXT NOT NULL,
    "geographic_impact" JSONB NOT NULL,
    "supply_chain_impact" JSONB NOT NULL,
    "financial_impact_estimate" DOUBLE PRECISION,
    "risk_factors" TEXT[],
    "affected_domains" TEXT[],
    "mitigation_suggestions" TEXT[],
    "assessed_by" TEXT NOT NULL DEFAULT 'monitoring_agent',
    "assessment_model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventHash" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "original_event_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventHash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringAuditLog" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "event_type" TEXT NOT NULL,
    "source" TEXT,
    "status" TEXT NOT NULL,
    "events_detected" INTEGER NOT NULL DEFAULT 0,
    "events_filtered" INTEGER NOT NULL DEFAULT 0,
    "events_published" INTEGER NOT NULL DEFAULT 0,
    "duplicates_found" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "error_stack" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_email_domain_idx" ON "Organization"("email_domain");

-- CreateIndex
CREATE INDEX "Organization_is_root_idx" ON "Organization"("is_root");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationContext_organization_id_key" ON "OrganizationContext"("organization_id");

-- CreateIndex
CREATE INDEX "OrganizationContext_organization_id_idx" ON "OrganizationContext"("organization_id");

-- CreateIndex
CREATE INDEX "Event_organization_id_validation_status_idx" ON "Event"("organization_id", "validation_status");

-- CreateIndex
CREATE INDEX "Event_organization_id_event_timestamp_idx" ON "Event"("organization_id", "event_timestamp");

-- CreateIndex
CREATE INDEX "Event_event_hash_idx" ON "Event"("event_hash");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE INDEX "Event_source_idx" ON "Event"("source");

-- CreateIndex
CREATE UNIQUE INDEX "Event_organization_id_event_hash_key" ON "Event"("organization_id", "event_hash");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_event_id_key" ON "Incident"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_incident_number_key" ON "Incident"("incident_number");

-- CreateIndex
CREATE INDEX "Incident_organization_id_status_idx" ON "Incident"("organization_id", "status");

-- CreateIndex
CREATE INDEX "Incident_organization_id_priority_idx" ON "Incident"("organization_id", "priority");

-- CreateIndex
CREATE INDEX "Incident_incident_number_idx" ON "Incident"("incident_number");

-- CreateIndex
CREATE INDEX "Incident_created_at_idx" ON "Incident"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "RiskAssessment_event_id_key" ON "RiskAssessment"("event_id");

-- CreateIndex
CREATE INDEX "RiskAssessment_organization_id_risk_category_idx" ON "RiskAssessment"("organization_id", "risk_category");

-- CreateIndex
CREATE INDEX "RiskAssessment_organization_id_severity_score_idx" ON "RiskAssessment"("organization_id", "severity_score");

-- CreateIndex
CREATE INDEX "RiskAssessment_event_id_idx" ON "RiskAssessment"("event_id");

-- CreateIndex
CREATE INDEX "EventHash_organization_id_expires_at_idx" ON "EventHash"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "EventHash_hash_idx" ON "EventHash"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "EventHash_organization_id_hash_key" ON "EventHash"("organization_id", "hash");

-- CreateIndex
CREATE INDEX "MonitoringAuditLog_organization_id_created_at_idx" ON "MonitoringAuditLog"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "MonitoringAuditLog_event_type_idx" ON "MonitoringAuditLog"("event_type");

-- CreateIndex
CREATE INDEX "MonitoringAuditLog_status_idx" ON "MonitoringAuditLog"("status");

-- AddForeignKey
ALTER TABLE "OrganizationContext" ADD CONSTRAINT "OrganizationContext_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventHash" ADD CONSTRAINT "EventHash_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
