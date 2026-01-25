-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('MANUAL', 'AUTOMATIC', 'BOTH');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('TRIGGER', 'ACTION', 'CONDITION', 'NOTIFICATION', 'END');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "viewport_x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewport_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewport_zoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "execution_mode" "ExecutionMode" NOT NULL DEFAULT 'MANUAL',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowNode" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "label" TEXT,
    "position_x" DOUBLE PRECISION NOT NULL,
    "position_y" DOUBLE PRECISION NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEdge" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "source_node_id" TEXT NOT NULL,
    "target_node_id" TEXT NOT NULL,
    "source_handle" TEXT,
    "target_handle" TEXT,
    "label" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "triggered_by" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "execution_log" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workflow_organization_id_idx" ON "Workflow"("organization_id");

-- CreateIndex
CREATE INDEX "Workflow_organization_id_status_idx" ON "Workflow"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_organization_id_name_key" ON "Workflow"("organization_id", "name");

-- CreateIndex
CREATE INDEX "WorkflowNode_workflow_id_idx" ON "WorkflowNode"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowNode_workflow_id_client_id_key" ON "WorkflowNode"("workflow_id", "client_id");

-- CreateIndex
CREATE INDEX "WorkflowEdge_workflow_id_idx" ON "WorkflowEdge"("workflow_id");

-- CreateIndex
CREATE INDEX "WorkflowEdge_source_node_id_idx" ON "WorkflowEdge"("source_node_id");

-- CreateIndex
CREATE INDEX "WorkflowEdge_target_node_id_idx" ON "WorkflowEdge"("target_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEdge_workflow_id_client_id_key" ON "WorkflowEdge"("workflow_id", "client_id");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflow_id_idx" ON "WorkflowExecution"("workflow_id");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflow_id_status_idx" ON "WorkflowExecution"("workflow_id", "status");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowNode" ADD CONSTRAINT "WorkflowNode_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEdge" ADD CONSTRAINT "WorkflowEdge_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEdge" ADD CONSTRAINT "WorkflowEdge_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "WorkflowNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEdge" ADD CONSTRAINT "WorkflowEdge_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "WorkflowNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
