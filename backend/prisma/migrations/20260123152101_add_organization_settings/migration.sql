-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "monitoring_agent_enabled" BOOLEAN NOT NULL DEFAULT true,
    "monitoring_polling_interval_ms" INTEGER NOT NULL DEFAULT 15000,
    "monitoring_enabled_sources" JSONB NOT NULL DEFAULT '{"weather":true,"political":true,"cybersecurity":true,"economic":true,"news":true,"maritime":true,"labor":true,"regulatory":true,"pandemic":true,"geopolitical":true}',
    "ai_model_provider" TEXT NOT NULL DEFAULT 'openai',
    "ai_model_name" TEXT NOT NULL DEFAULT 'gpt-4o',
    "ai_model_temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "ai_max_tokens" INTEGER NOT NULL DEFAULT 4096,
    "notifications_email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifications_email_recipients" JSONB NOT NULL DEFAULT '[]',
    "notifications_severity_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "notifications_slack_enabled" BOOLEAN NOT NULL DEFAULT false,
    "notifications_slack_webhook_url" TEXT,
    "notifications_digest_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifications_digest_frequency" TEXT NOT NULL DEFAULT 'weekly',
    "integration_sap_configured" BOOLEAN NOT NULL DEFAULT false,
    "integration_sap_last_sync" TIMESTAMP(3),
    "integration_sap_sync_frequency" TEXT NOT NULL DEFAULT 'daily',
    "retention_events_days" INTEGER NOT NULL DEFAULT 365,
    "retention_audit_logs_days" INTEGER NOT NULL DEFAULT 90,
    "retention_incidents_days" INTEGER NOT NULL DEFAULT 730,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_organization_id_key" ON "OrganizationSettings"("organization_id");

-- CreateIndex
CREATE INDEX "OrganizationSettings_organization_id_idx" ON "OrganizationSettings"("organization_id");

-- AddForeignKey
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
