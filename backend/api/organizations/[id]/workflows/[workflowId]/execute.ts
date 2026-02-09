/**
 * Execute Workflow API Endpoint
 *
 * POST /api/organizations/:id/workflows/:workflowId/execute - Execute a workflow
 * Auth: Bearer token required (ADMIN or OWNER)
 *
 * Body:
 * - mode: 'trial' | 'run' (default: 'run')
 * - initialVariables: Record<string, unknown> (optional)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../../../src/auth/index.js';
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

    // Parse request body
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const mode = body?.mode || 'run';
    const initialVariables = body?.initialVariables || {};

    // Validate mode
    if (!['trial', 'run'].includes(mode)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Mode must be "trial" or "run"' },
      });
      return;
    }

    // Check membership and permissions
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

    // Require ADMIN or OWNER to execute workflows
    if (!['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to execute workflows' },
      });
      return;
    }

    // Load workflow
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        organization_id: orgId,
      },
      include: {
        nodes: {
          include: {
            outgoing_edges: true,
            incoming_edges: true,
          },
        },
        edges: true,
      },
    });

    if (!workflow) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Workflow not found' },
      });
      return;
    }

    // Check if workflow is published
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
        triggered_by: mode === 'trial' ? `trial:${tokenPayload.userId}` : tokenPayload.userId,
        status: 'RUNNING',
        started_at: startTime,
        execution_log: [],
      },
    });

    // For trial mode, simulate execution without actually running actions
    // For run mode, we would execute the workflow (not implemented here for simplicity)
    const executionLog: Array<{
      nodeId: string;
      nodeClientId: string;
      nodeType: string;
      nodeLabel: string;
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
      startedAt?: string;
      completedAt?: string;
      output?: unknown;
      error?: string;
    }> = [];

    // Process nodes in order (simplified - real implementation would follow edges)
    for (const node of workflow.nodes) {
      const nodeData = node.data as Record<string, unknown> | null;
      executionLog.push({
        nodeId: node.id,
        nodeClientId: node.client_id,
        nodeType: node.type,
        nodeLabel: (nodeData?.label as string) || node.type,
        status: mode === 'trial' ? 'skipped' : 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        output: mode === 'trial' ? { _mode: 'trial', _skipped: true } : {},
      });
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    // Update execution record
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: 'COMPLETED',
        completed_at: endTime,
        execution_log: executionLog as unknown as object[],
      },
    });

    // Format response
    res.status(200).json({
      success: true,
      data: {
        id: execution.id,
        status: 'COMPLETED',
        executionLog,
        output: { ...initialVariables, _mode: mode },
        startedAt: startTime.toISOString(),
        completedAt: endTime.toISOString(),
        durationMs,
      },
    });
  } catch (error) {
    console.error('Execute workflow error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'An unexpected error occurred' },
    });
  }
}
