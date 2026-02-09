/**
 * Publish Workflow API Endpoint
 *
 * POST /api/organizations/:id/workflows/:workflowId/publish - Publish a workflow
 * Auth: Bearer token required (ADMIN or OWNER)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../_cors.js';

const prisma = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatWorkflow(workflow: any) {
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
    counts: workflow._count,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST requests are supported' },
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

    const membership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: orgId,
        },
      },
    });

    if (membership?.status !== 'active') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    // Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to publish workflows' },
      });
      return;
    }

    const existing = await prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: orgId },
      include: {
        nodes: true,
      },
    });

    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Workflow not found' },
      });
      return;
    }

    // Validate workflow has required nodes
    const hasTrigger = existing.nodes.some((n) => n.type === 'TRIGGER');
    const hasEnd = existing.nodes.some((n) => n.type === 'END');

    if (!hasTrigger || !hasEnd) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_WORKFLOW',
          message: 'Workflow must have at least one trigger and one end node',
        },
      });
      return;
    }

    // Update status to PUBLISHED
    const workflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: 'PUBLISHED',
        is_active: true,
      },
      include: {
        _count: { select: { nodes: true, edges: true, executions: true } },
      },
    });

    res.status(200).json({ success: true, data: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Publish workflow error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
