/**
 * Data Source Tool Configs API Endpoint
 *
 * GET /api/organizations/:id/tool-configs/:dataSource - Get configs for a specific data source
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../_cors.js';
import { DATA_SOURCE_DEFINITIONS } from '../../../../../src/monitoring/tool-configs.js';

const prisma = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatToolConfig(config: any) {
  return {
    id: config.id,
    organizationId: config.organization_id,
    dataSource: config.data_source,
    toolId: config.tool_id,
    toolName: config.tool_name,
    enabled: config.enabled,
    apiTimeoutMs: config.api_timeout_ms,
    severityThreshold: config.severity_threshold,
    lookbackHours: config.lookback_hours,
    config: config.config,
    apiKeyConfigured: !!(config.api_key_encrypted || config.api_key_env_var),
    apiKeyEnvVar: config.api_key_env_var,
    description: config.description,
    documentationUrl: config.documentation_url,
    lastSuccessAt: config.last_success_at?.toISOString() ?? null,
    lastErrorAt: config.last_error_at?.toISOString() ?? null,
    lastErrorMessage: config.last_error_message,
    totalEventsFetched: config.total_events_fetched,
    createdAt: config.created_at.toISOString(),
    updatedAt: config.updated_at.toISOString(),
  };
}

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

    if (!orgId || !dataSource) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID and data source are required' },
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

    // Validate data source
    const sourceDefinition = DATA_SOURCE_DEFINITIONS.find(ds => ds.id === dataSource);
    if (!sourceDefinition) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA_SOURCE', message: `Invalid data source: ${dataSource}` },
      });
      return;
    }

    const configs = await prisma.dataSourceToolConfig.findMany({
      where: { organization_id: orgId, data_source: dataSource },
      orderBy: { tool_id: 'asc' },
    });

    res.status(200).json({
      success: true,
      data: {
        dataSource: sourceDefinition,
        configs: configs.map(formatToolConfig),
      },
    });
  } catch (error) {
    console.error('Get data source configs error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
