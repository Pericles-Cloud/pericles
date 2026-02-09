/**
 * Tool API Key Status Endpoint
 *
 * GET /api/organizations/:id/tool-configs/:dataSource/:toolId/api-key-status - Get API key status for a tool
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../../_cors.js';
import { type DataSourceCategory, getToolDefinition } from '../../../../../../src/monitoring/tool-configs.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET requests are supported' },
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
    const dataSource = req.query.dataSource as string;
    const toolId = req.query.toolId as string;

    if (!orgId || !dataSource || !toolId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID, data source, and tool ID are required' },
      });
      return;
    }

    // Check if user has access to this organization
    const membership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: orgId,
        },
      },
    });

    if (!membership) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
      return;
    }

    // Verify tool exists
    const toolDef = getToolDefinition(dataSource as DataSourceCategory, toolId);
    if (!toolDef) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tool not found' },
      });
      return;
    }

    // Get config
    const config = await prisma.dataSourceToolConfig.findUnique({
      where: {
        organization_id_data_source_tool_id: {
          organization_id: orgId,
          data_source: dataSource,
          tool_id: toolId,
        },
      },
    });

    // Determine API key status
    let status: 'not_required' | 'configured' | 'env_var' | 'not_configured';
    let envVarName: string | null = null;
    let envVarConfigured = false;

    if (!toolDef.requiresApiKey && !toolDef.apiKeyEnvVar) {
      status = 'not_required';
    } else if (config?.api_key_encrypted) {
      status = 'configured';
    } else if (config?.api_key_env_var || toolDef.apiKeyEnvVar) {
      envVarName = config?.api_key_env_var || toolDef.apiKeyEnvVar || null;
      envVarConfigured = envVarName ? !!process.env[envVarName] : false;
      status = envVarConfigured ? 'env_var' : 'not_configured';
    } else {
      status = 'not_configured';
    }

    res.status(200).json({
      success: true,
      data: {
        requiresApiKey: toolDef.requiresApiKey ?? false,
        apiKeyLabel: toolDef.apiKeyLabel,
        apiKeyEnvVar: toolDef.apiKeyEnvVar,
        status,
        envVarName,
        envVarConfigured,
        lastSuccessAt: config?.last_success_at ?? null,
        lastErrorAt: config?.last_error_at ?? null,
        lastErrorMessage: config?.last_error_message ?? null,
      },
    });
  } catch (error) {
    console.error('Get API key status error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
