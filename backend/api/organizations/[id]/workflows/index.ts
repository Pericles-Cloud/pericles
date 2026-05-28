/**
 * Workflows List API Endpoint
 *
 * GET /api/organizations/:id/workflows - List workflows for an organization
 * POST /api/organizations/:id/workflows - Create a new workflow
 * Auth: Bearer token required (ADMIN or OWNER for POST)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticateRequest, checkOrganizationAccess } from '../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../_cors.js';

const prisma = new PrismaClient();

type NodeType = 'TRIGGER' | 'ACTION' | 'CONDITION' | 'NOTIFICATION' | 'END';
type ExecutionMode = 'MANUAL' | 'AUTOMATIC' | 'BOTH';

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  executionMode: z.enum(['MANUAL', 'AUTOMATIC', 'BOTH']).optional().default('MANUAL'),
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

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported' },
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

    if (!orgId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID is required' },
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
      const status = req.query.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | undefined;
      const workflows = await prisma.workflow.findMany({
        where: {
          organization_id: orgId,
          ...(status && { status }),
        },
        include: {
          _count: { select: { nodes: true, edges: true, executions: true } },
        },
        orderBy: { updated_at: 'desc' },
      });

      res.status(200).json({
        success: true,
        data: workflows.map((w) => formatWorkflow(w)),
      });
      return;
    }

    // POST - Create workflow - Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to create workflows' },
      });
      return;
    }

    const parseResult = CreateWorkflowSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parseResult.error.errors[0].message },
      });
      return;
    }

    const { name, description, executionMode } = parseResult.data;

    // Check for duplicate name
    const existing = await prisma.workflow.findUnique({
      where: { organization_id_name: { organization_id: orgId, name } },
    });
    if (existing) {
      res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'A workflow with this name already exists' },
      });
      return;
    }

    // Create workflow with default nodes and edges in a transaction
    const workflow = await prisma.$transaction(async (tx) => {
      // Create the workflow
      const wf = await tx.workflow.create({
        data: {
          organization_id: orgId,
          name,
          description: description || null,
          execution_mode: executionMode as ExecutionMode,
          created_by: tokenPayload.userId,
          viewport_x: 0,
          viewport_y: 0,
          viewport_zoom: 1,
        },
      });

      // Default nodes
      const defaultNodes = [
        { clientId: 'trigger-1', type: 'TRIGGER' as NodeType, label: 'Trigger', x: 50, y: 150, data: { subtitle: 'Configure' } },
        { clientId: 'action-1', type: 'ACTION' as NodeType, label: 'Flow 1', x: 220, y: 150, data: { owner: '', rules: [] } },
        { clientId: 'action-2', type: 'ACTION' as NodeType, label: 'Flow 1', x: 420, y: 50, data: { owner: '', rules: [] } },
        { clientId: 'action-3', type: 'ACTION' as NodeType, label: 'Flow 1', x: 420, y: 250, data: { owner: '', rules: [] } },
        { clientId: 'action-4', type: 'ACTION' as NodeType, label: 'Flow 1', x: 620, y: 250, data: { owner: '', rules: [] } },
        { clientId: 'action-5', type: 'ACTION' as NodeType, label: 'Flow 1', x: 820, y: 150, data: { owner: '', rules: [] } },
        { clientId: 'end-1', type: 'END' as NodeType, label: 'Resolved', x: 1020, y: 150, data: {} },
      ];

      // Create nodes
      const createdNodes: Array<{ id: string; clientId: string }> = [];
      for (const node of defaultNodes) {
        const created = await tx.workflowNode.create({
          data: {
            workflow_id: wf.id,
            client_id: node.clientId,
            type: node.type,
            label: node.label,
            position_x: node.x,
            position_y: node.y,
            data: node.data,
          },
        });
        createdNodes.push({ id: created.id, clientId: node.clientId });
      }

      // Helper to get node ID by client ID
      const getNodeId = (clientId: string) => createdNodes.find(n => n.clientId === clientId)?.id || '';

      // Default edges
      const defaultEdges = [
        { clientId: 'edge-1', sourceClientId: 'trigger-1', targetClientId: 'action-1' },
        { clientId: 'edge-2', sourceClientId: 'action-1', targetClientId: 'action-2' },
        { clientId: 'edge-3', sourceClientId: 'action-1', targetClientId: 'action-3' },
        { clientId: 'edge-4', sourceClientId: 'action-2', targetClientId: 'action-5' },
        { clientId: 'edge-5', sourceClientId: 'action-3', targetClientId: 'action-4' },
        { clientId: 'edge-6', sourceClientId: 'action-4', targetClientId: 'action-5' },
        { clientId: 'edge-7', sourceClientId: 'action-5', targetClientId: 'end-1' },
      ];

      // Create edges
      for (const edge of defaultEdges) {
        await tx.workflowEdge.create({
          data: {
            workflow_id: wf.id,
            client_id: edge.clientId,
            source_node_id: getNodeId(edge.sourceClientId),
            target_node_id: getNodeId(edge.targetClientId),
          },
        });
      }

      // Return workflow with counts
      return tx.workflow.findUnique({
        where: { id: wf.id },
        include: {
          _count: { select: { nodes: true, edges: true, executions: true } },
        },
      });
    });

    if (!workflow) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to create workflow' },
      });
      return;
    }

    res.status(201).json({ success: true, data: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Workflows endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
