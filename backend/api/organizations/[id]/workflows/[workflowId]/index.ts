/**
 * Single Workflow API Endpoint
 *
 * GET /api/organizations/:id/workflows/:workflowId - Get workflow with nodes and edges
 * PATCH /api/organizations/:id/workflows/:workflowId - Update workflow metadata
 * DELETE /api/organizations/:id/workflows/:workflowId - Delete workflow
 * Auth: Bearer token required (ADMIN or OWNER for PATCH/DELETE)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticateRequest, checkOrganizationAccess } from '../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../_cors.js';

const prisma = new PrismaClient();

type ExecutionMode = 'MANUAL' | 'AUTOMATIC' | 'BOTH';

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  executionMode: z.enum(['MANUAL', 'AUTOMATIC', 'BOTH']).optional(),
  isActive: z.boolean().optional(),
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

  if (!['GET', 'PATCH', 'DELETE'].includes(req.method || '')) {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET, PATCH, and DELETE requests are supported' },
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

    // Check user has access to this organization (direct membership or root org member)
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, orgId);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    const userRole = accessResult.membership.role;

    if (req.method === 'GET') {
      const workflow = await prisma.workflow.findFirst({
        where: { id: workflowId, organization_id: orgId },
        include: {
          nodes: { orderBy: { created_at: 'asc' } },
          edges: { orderBy: { created_at: 'asc' } },
          _count: { select: { nodes: true, edges: true, executions: true } },
        },
      });

      if (!workflow) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Workflow not found' },
        });
        return;
      }

      // Create a map from node id to client_id for edge formatting
      const nodeClientIdMap = new Map(workflow.nodes.map((n) => [n.id, n.client_id]));

      res.status(200).json({ success: true, data: formatWorkflow(workflow, nodeClientIdMap) });
      return;
    }

    // PATCH and DELETE require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
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

    if (req.method === 'DELETE') {
      await prisma.workflow.delete({ where: { id: workflowId } });

      res.status(200).json({
        success: true,
        data: { message: 'Workflow deleted successfully' },
      });
      return;
    }

    // PATCH - Update workflow metadata
    const parseResult = UpdateWorkflowSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
      });
      return;
    }

    const { name, description, executionMode, isActive, viewportX, viewportY, viewportZoom } = parseResult.data;

    // Check for duplicate name if changing
    if (name && name !== existing.name) {
      const duplicate = await prisma.workflow.findUnique({
        where: { organization_id_name: { organization_id: orgId, name } },
      });
      if (duplicate) {
        res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: 'A workflow with this name already exists' },
        });
        return;
      }
    }

    const workflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(executionMode !== undefined && { execution_mode: executionMode as ExecutionMode }),
        ...(isActive !== undefined && { is_active: isActive }),
        ...(viewportX !== undefined && { viewport_x: viewportX }),
        ...(viewportY !== undefined && { viewport_y: viewportY }),
        ...(viewportZoom !== undefined && { viewport_zoom: viewportZoom }),
      },
      include: {
        _count: { select: { nodes: true, edges: true, executions: true } },
      },
    });

    res.status(200).json({ success: true, data: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Workflow endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
