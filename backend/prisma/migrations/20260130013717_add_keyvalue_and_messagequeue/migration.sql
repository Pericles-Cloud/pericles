-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "KeyValueStore" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'default',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyValueStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageQueue" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "queue_name" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyValueStore_organization_id_namespace_idx" ON "KeyValueStore"("organization_id", "namespace");

-- CreateIndex
CREATE INDEX "KeyValueStore_namespace_key_idx" ON "KeyValueStore"("namespace", "key");

-- CreateIndex
CREATE INDEX "KeyValueStore_expires_at_idx" ON "KeyValueStore"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "KeyValueStore_organization_id_namespace_key_key" ON "KeyValueStore"("organization_id", "namespace", "key");

-- CreateIndex
CREATE INDEX "MessageQueue_queue_name_status_idx" ON "MessageQueue"("queue_name", "status");

-- CreateIndex
CREATE INDEX "MessageQueue_organization_id_queue_name_idx" ON "MessageQueue"("organization_id", "queue_name");

-- CreateIndex
CREATE INDEX "MessageQueue_status_scheduled_at_idx" ON "MessageQueue"("status", "scheduled_at");
