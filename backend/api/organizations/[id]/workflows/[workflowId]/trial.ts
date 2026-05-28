/**
 * Trial Run Workflow API Endpoint
 *
 * POST /api/organizations/:id/workflows/:workflowId/trial - Execute a workflow trial
 * Auth: Bearer token required (ADMIN or OWNER)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../_cors.js';

const prisma = new PrismaClient();

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

    // Check membership
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, orgId);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    const userRole = accessResult.membership.role;

    if (!['OWNER', 'ADMIN'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      });
      return;
    }

    // Load workflow
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organization_id: orgId },
      include: { nodes: true, edges: true },
    });

    if (!workflow) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Workflow not found' },
      });
      return;
    }

    if (workflow.status !== 'PUBLISHED') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Only published workflows can be executed' },
      });
      return;
    }

    const startTime = new Date();

    // Create execution record
    const execution = await prisma.workflowExecution.create({
      data: {
        workflow_id: workflowId,
        triggered_by: `trial:${tokenPayload.userId}`,
        status: 'RUNNING',
        started_at: startTime,
        execution_log: [],
      },
    });

    // Simulate trial execution
    const executionLog = workflow.nodes.map((node) => ({
      nodeId: node.id,
      nodeClientId: node.client_id,
      nodeType: node.type,
      nodeLabel: (node.data as Record<string, unknown> | null)?.label || node.type,
      status: 'skipped',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      output: { _mode: 'trial', _skipped: true },
    }));

    const endTime = new Date();

    // Update execution
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: 'COMPLETED',
        completed_at: endTime,
        execution_log: executionLog,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        id: execution.id,
        status: 'COMPLETED',
        executionLog,
        output: { _mode: 'trial' },
        startedAt: startTime.toISOString(),
        completedAt: endTime.toISOString(),
        durationMs: endTime.getTime() - startTime.getTime(),
      },
    });
  } catch (error) {
    console.error('Trial workflow error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'An error occurred' },
    });
  }
}
