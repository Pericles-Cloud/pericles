-- §13 foundation: idempotent queue publish, claim lock fields, and the dispatch log.
-- Hand-trimmed from `prisma migrate diff`: the unrelated SecretAuditLog index and
-- OrganizationSecret default drift that already exists between the migration history
-- and schema.prisma are intentionally NOT included here.

-- AlterTable
ALTER TABLE "MessageQueue" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "locked_by" TEXT;

-- CreateTable
CREATE TABLE "DispatchLog" (
    "id" TEXT NOT NULL,
    "queue_message_id" TEXT,
    "record_id" TEXT NOT NULL,
    "record_version" INTEGER NOT NULL,
    "record_type" TEXT NOT NULL,
    "organization_id" TEXT,
    "consumer" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchLog_organization_id_created_at_idx" ON "DispatchLog"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "DispatchLog_record_id_idx" ON "DispatchLog"("record_id");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchLog_consumer_record_id_record_version_key" ON "DispatchLog"("consumer", "record_id", "record_version");

-- CreateIndex
CREATE UNIQUE INDEX "MessageQueue_queue_name_idempotency_key_key" ON "MessageQueue"("queue_name", "idempotency_key");
