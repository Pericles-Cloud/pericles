-- CreateTable
CREATE TABLE "DataSourceToolConfig" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "data_source" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "api_timeout_ms" INTEGER NOT NULL DEFAULT 15000,
    "severity_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lookback_hours" INTEGER NOT NULL DEFAULT 24,
    "config" JSONB NOT NULL DEFAULT '{}',
    "api_key_encrypted" TEXT,
    "api_key_env_var" TEXT,
    "description" TEXT,
    "documentation_url" TEXT,
    "last_success_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error_message" TEXT,
    "total_events_fetched" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSourceToolConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataSourceToolConfig_organization_id_data_source_idx" ON "DataSourceToolConfig"("organization_id", "data_source");

-- CreateIndex
CREATE INDEX "DataSourceToolConfig_organization_id_enabled_idx" ON "DataSourceToolConfig"("organization_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceToolConfig_organization_id_data_source_tool_id_key" ON "DataSourceToolConfig"("organization_id", "data_source", "tool_id");

-- AddForeignKey
ALTER TABLE "DataSourceToolConfig" ADD CONSTRAINT "DataSourceToolConfig_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
