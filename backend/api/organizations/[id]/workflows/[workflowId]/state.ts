/**
 * Workflow State API Endpoint
 *
 * PUT /api/organizations/:id/workflows/:workflowId/state - Save workflow state (nodes and edges)
 * Auth: Bearer token required (ADMIN or OWNER)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticateRequest, checkOrganizationAccess } from '../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../_cors.js';

const prisma = new PrismaClient();

const WorkflowNodeSchema = z.object({
  clientId: z.string(),
  type: z.enum(['TRIGGER', 'ACTION', 'CONDITION', 'NOTIFICATION', 'END']),
  label: z.string().optional(),
  positionX: z.number(),
  positionY: z.number(),
  data: z.record(z.unknown()).optional().default({}),
});

const WorkflowEdgeSchema = z.object({
  clientId: z.string(),
  sourceNodeClientId: z.string(),
  targetNodeClientId: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  data: z.record(z.unknown()).optional().default({}),
});

const SaveWorkflowStateSchema = z.object({
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  viewportX: z.number().optional(),
  viewportY: z.number().optional(),
  viewportZoom: z.number().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatWorkflow(workflow: any, nodeClientIdMap?: Map<string, string>) {
  return {
    id: workflow.id,
    organizationId: workflow.organization_id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    version: workflow.version,
    viewport: {
      x: workflow.viewport_x,
      y: workflow.viewport_y,
      zoom: workflow.viewport_zoom,
    },
    executionMode: workflow.execution_mode,
    isActive: workflow.is_active,
    createdBy: workflow.created_by,
    createdAt: workflow.created_at.toISOString(),
    updatedAt: workflow.updated_at.toISOString(),
    nodes: workflow.nodes?.map((node: { id: string; client_id: string; type: string; label: string | null; position_x: number; position_y: number; data: Prisma.JsonValue }) => ({
      id: node.id,
      clientId: node.client_id,
      type: node.type,
      label: node.label,
      position: { x: node.position_x, y: node.position_y },
      data: node.data,
    })),
    edges: workflow.edges?.map((edge: { id: string; client_id: string; source_node_id: string; target_node_id: string; source_handle: string | null; target_handle: string | null; label: string | null; data: Prisma.JsonValue }) => ({
      id: edge.id,
      clientId: edge.client_id,
      source: nodeClientIdMap?.get(edge.source_node_id) || edge.source_node_id,
      target: nodeClientIdMap?.get(edge.target_node_id) || edge.target_node_id,
      sourceHandle: edge.source_handle,
      targetHandle: edge.target_handle,
      label: edge.label,
      data: edge.data,
    })),
    counts: workflow._count,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (req.method !== 'PUT') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only PUT requests are supported' },
    });
    return;
  }

  try {
    const tokenPayload = authenticateRequest(req);
    if (!tokenPayload) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const orgId = req.query.id as string;
    const workflowId = req.query.workflowId as string;

    if (!orgId || !workflowId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID and workflow ID are required' },
      });
      return;
    }

    const accessResult = await checkOrganizationAccess(tokenPayload.userId, orgId);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    const userRole = accessResult.membership.role;

    // Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      });
      return;
    }

    const parseResult = SaveWorkflowStateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
      });
      return;
    }

    const existing = await prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: orgId },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Workflow not found' },
      });
      return;
    }

    const { nodes, edges, viewportX, viewportY, viewportZoom } = parseResult.data;

    // Use a transaction to replace nodes and edges
    const workflow = await prisma.$transaction(async (tx) => {
      // Delete existing edges first (due to FK constraints)
      await tx.workflowEdge.deleteMany({ where: { workflow_id: workflowId } });
      // Delete existing nodes
      await tx.workflowNode.deleteMany({ where: { workflow_id: workflowId } });

      // Create nodes
      const createdNodes = await Promise.all(
        nodes.map((node) =>
          tx.workflowNode.create({
            data: {
              workflow_id: workflowId,
              client_id: node.clientId,
              type: node.type,
              label: node.label || null,
              position_x: node.positionX,
              position_y: node.positionY,
              data: (node.data || {}) as Prisma.InputJsonValue,
            },
          })
        )
      );

      // Map client_id to node id for edges
      const clientIdToNodeId = new Map(createdNodes.map((n) => [n.client_id, n.id]));

      // Create edges
      for (const edge of edges) {
        const sourceNodeId = clientIdToNodeId.get(edge.sourceNodeClientId);
        const targetNodeId = clientIdToNodeId.get(edge.targetNodeClientId);

        if (!sourceNodeId || !targetNodeId) {
          throw new Error(`Invalid edge: source or target node not found (${edge.sourceNodeClientId} -> ${edge.targetNodeClientId})`);
        }

        await tx.workflowEdge.create({
          data: {
            workflow_id: workflowId,
            client_id: edge.clientId,
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            source_handle: edge.sourceHandle || null,
            target_handle: edge.targetHandle || null,
            label: edge.label || null,
            data: (edge.data || {}) as Prisma.InputJsonValue,
          },
        });
      }

      // Update workflow with viewport and increment version
      return tx.workflow.update({
        where: { id: workflowId },
        data: {
          version: { increment: 1 },
          ...(viewportX !== undefined && { viewport_x: viewportX }),
          ...(viewportY !== undefined && { viewport_y: viewportY }),
          ...(viewportZoom !== undefined && { viewport_zoom: viewportZoom }),
        },
        include: {
          nodes: { orderBy: { created_at: 'asc' } },
          edges: { orderBy: { created_at: 'asc' } },
          _count: { select: { nodes: true, edges: true, executions: true } },
        },
      });
    });

    // Create a map from node id to client_id for edge formatting
    const nodeClientIdMap = new Map(workflow.nodes.map((n) => [n.id, n.client_id]));

    res.status(200).json({ success: true, data: formatWorkflow(workflow, nodeClientIdMap) });
  } catch (error) {
    console.error('Save workflow state error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message },
    });
  }
}
