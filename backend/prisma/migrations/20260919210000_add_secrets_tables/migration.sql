-- CreateEnum
CREATE TYPE "SecretScope" AS ENUM ('ORGANIZATION', 'INTEGRATION', 'TOOL');

-- CreateEnum
CREATE TYPE "SecretType" AS ENUM ('SECRET', 'VARIABLE');

-- CreateEnum
CREATE TYPE "SecretAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'ROTATE', 'REVEAL');

-- CreateTable
CREATE TABLE "OrganizationSecret" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "SecretScope" NOT NULL DEFAULT 'ORGANIZATION',
    "scope_ref" TEXT,
    "secret_type" "SecretType" NOT NULL DEFAULT 'SECRET',
    "value_encrypted" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rotated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretAuditLog" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" "SecretAction" NOT NULL,
    "secret_name" TEXT NOT NULL,
    "secret_scope" "SecretScope" NOT NULL,
    "secret_scope_ref" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSecret_organization_id_name_scope_scope_ref_key" ON "OrganizationSecret"("organization_id", "name", "scope", "scope_ref");

-- CreateIndex
CREATE INDEX "OrganizationSecret_organization_id_scope_idx" ON "OrganizationSecret"("organization_id", "scope");

-- CreateIndex
CREATE INDEX "OrganizationSecret_organization_id_scope_ref_idx" ON "OrganizationSecret"("organization_id", "scope_ref");

-- CreateIndex
CREATE INDEX "OrganizationSecret_organization_id_secret_type_idx" ON "OrganizationSecret"("organization_id", "secret_type");

-- CreateIndex
CREATE INDEX "SecretAuditLog_organization_id_idx" ON "SecretAuditLog"("organization_id");

-- CreateIndex
CREATE INDEX "SecretAuditLog_user_id_idx" ON "SecretAuditLog"("user_id");

-- CreateIndex
CREATE INDEX "SecretAuditLog_action_idx" ON "SecretAuditLog"("action");

-- CreateIndex
CREATE INDEX "SecretAuditLog_created_at_idx" ON "SecretAuditLog"("created_at");

-- AddForeignKey
ALTER TABLE "OrganizationSecret" ADD CONSTRAINT "OrganizationSecret_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretAuditLog" ADD CONSTRAINT "SecretAuditLog_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
