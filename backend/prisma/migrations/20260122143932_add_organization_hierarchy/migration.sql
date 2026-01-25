-- Migration: Add Organization Hierarchy Support
-- Changes email_domain to email_domains (array)
-- Adds parent_organization_id for hierarchical organizations

-- DropIndex
DROP INDEX IF EXISTS "Organization_email_domain_idx";

-- AlterTable - Add new columns first, then migrate data, then drop old column
ALTER TABLE "Organization"
ADD COLUMN "email_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "parent_organization_id" TEXT;

-- Migrate existing email_domain data to email_domains array
UPDATE "Organization"
SET "email_domains" = ARRAY["email_domain"]::TEXT[]
WHERE "email_domain" IS NOT NULL AND "email_domain" != '';

-- Drop old column
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "email_domain";

-- CreateIndex
CREATE INDEX "Organization_parent_organization_id_idx" ON "Organization"("parent_organization_id");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parent_organization_id_fkey" FOREIGN KEY ("parent_organization_id") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
