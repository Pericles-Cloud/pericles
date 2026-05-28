/**
 * Single Tool Config API Endpoint
 *
 * GET /api/organizations/:id/tool-configs/:dataSource/:toolId - Get a specific tool config
 * PUT /api/organizations/:id/tool-configs/:dataSource/:toolId - Create or update a tool config
 * DELETE /api/organizations/:id/tool-configs/:dataSource/:toolId - Delete a tool config (reset to defaults)
 * Auth: Bearer token required (ADMIN or OWNER for PUT/DELETE)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../../_cors.js';
import {
  type DataSourceCategory,
  getToolDefinition,
  getDefaultToolConfig,
  validateToolConfig,
} from '../../../../../../src/monitoring/tool-configs.js';

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
    createdAt: config.created_at?.toISOString() ?? null,
    updatedAt: config.updated_at?.toISOString() ?? null,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (!['GET', 'PUT', 'DELETE'].includes(req.method || '')) {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET, PUT, and DELETE requests are supported' },
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
    const dataSource = req.query.dataSource as DataSourceCategory;
    const toolId = req.query.toolId as string;

    if (!orgId || !dataSource || !toolId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID, data source, and tool ID are required' },
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

    // Get tool definition for validation and defaults
    const toolDef = getToolDefinition(dataSource, toolId);
    if (!toolDef) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_TOOL', message: `Invalid tool: ${dataSource}/${toolId}` },
      });
      return;
    }

    if (req.method === 'GET') {
      const config = await prisma.dataSourceToolConfig.findUnique({
        where: {
          organization_id_data_source_tool_id: {
            organization_id: orgId,
            data_source: dataSource,
            tool_id: toolId,
          },
        },
      });

      if (!config) {
        // Return default config if not yet customized
        res.status(200).json({
          success: true,
          data: {
            id: null,
            organizationId: orgId,
            dataSource,
            toolId,
            toolName: toolDef.name,
            enabled: toolDef.defaultEnabled,
            apiTimeoutMs: toolDef.defaultTimeoutMs,
            severityThreshold: toolDef.defaultSeverityThreshold,
            lookbackHours: toolDef.defaultLookbackHours,
            config: getDefaultToolConfig(toolDef),
            apiKeyConfigured: false,
            apiKeyEnvVar: toolDef.apiKeyEnvVar ?? null,
            description: toolDef.description,
            documentationUrl: toolDef.documentationUrl ?? null,
            lastSuccessAt: null,
            lastErrorAt: null,
            lastErrorMessage: null,
            totalEventsFetched: 0,
            createdAt: null,
            updatedAt: null,
            isDefault: true,
            toolDefinition: toolDef,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          ...formatToolConfig(config),
          isDefault: false,
          toolDefinition: toolDef,
        },
      });
      return;
    }

    // PUT and DELETE require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to update tool configurations' },
      });
      return;
    }

    if (req.method === 'DELETE') {
      await prisma.dataSourceToolConfig.deleteMany({
        where: {
          organization_id: orgId,
          data_source: dataSource,
          tool_id: toolId,
        },
      });

      res.status(200).json({
        success: true,
        data: { message: 'Tool configuration reset to defaults' },
      });
      return;
    }

    // PUT - Create or update
    const {
      enabled,
      apiTimeoutMs,
      severityThreshold,
      lookbackHours,
      config,
      apiKeyEnvVar,
      description,
    } = req.body;

    // Validate tool-specific config if provided
    if (config !== undefined) {
      const validation = validateToolConfig(toolDef, config);
      if (!validation.valid) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_CONFIG', message: 'Invalid tool configuration', details: validation.errors },
        });
        return;
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (enabled !== undefined) updateData.enabled = enabled;
    if (apiTimeoutMs !== undefined) updateData.api_timeout_ms = apiTimeoutMs;
    if (severityThreshold !== undefined) updateData.severity_threshold = severityThreshold;
    if (lookbackHours !== undefined) updateData.lookback_hours = lookbackHours;
    if (config !== undefined) updateData.config = config;
    if (apiKeyEnvVar !== undefined) updateData.api_key_env_var = apiKeyEnvVar;
    if (description !== undefined) updateData.description = description;

    const updatedConfig = await prisma.dataSourceToolConfig.upsert({
      where: {
        organization_id_data_source_tool_id: {
          organization_id: orgId,
          data_source: dataSource,
          tool_id: toolId,
        },
      },
      create: {
        organization_id: orgId,
        data_source: dataSource,
        tool_id: toolId,
        tool_name: toolDef.name,
        enabled: enabled ?? toolDef.defaultEnabled,
        api_timeout_ms: apiTimeoutMs ?? toolDef.defaultTimeoutMs,
        severity_threshold: severityThreshold ?? toolDef.defaultSeverityThreshold,
        lookback_hours: lookbackHours ?? toolDef.defaultLookbackHours,
        config: config ?? getDefaultToolConfig(toolDef),
        api_key_env_var: apiKeyEnvVar ?? toolDef.apiKeyEnvVar ?? null,
        description: description ?? toolDef.description,
        documentation_url: toolDef.documentationUrl ?? null,
      },
      update: updateData,
    });

    res.status(200).json({
      success: true,
      data: {
        ...formatToolConfig(updatedConfig),
        toolDefinition: toolDef,
      },
    });
  } catch (error) {
    console.error('Tool config endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
