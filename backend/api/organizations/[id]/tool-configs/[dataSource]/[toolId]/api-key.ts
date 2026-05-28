/**
 * Tool API Key Management Endpoint
 *
 * PUT /api/organizations/:id/tool-configs/:dataSource/:toolId/api-key - Save API key for a tool
 * Auth: Bearer token required (ADMIN or OWNER)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../../../_cors.js';
import {
  type DataSourceCategory,
  getToolDefinition,
  getDefaultToolConfig,
} from '../../../../../../src/monitoring/tool-configs.js';

const prisma = new PrismaClient();

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
    const dataSource = req.query.dataSource as string;
    const toolId = req.query.toolId as string;
    const { apiKey, useEnvVar } = req.body;

    if (!orgId || !dataSource || !toolId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Organization ID, data source, and tool ID are required' },
      });
      return;
    }

    // Check if user has access to this organization (must be ADMIN or OWNER)
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, orgId);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
      return;
    }

    const userRole = accessResult.membership.role;

    if (!['ADMIN', 'OWNER'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
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

    // Find or create the config
    let config = await prisma.dataSourceToolConfig.findUnique({
      where: {
        organization_id_data_source_tool_id: {
          organization_id: orgId,
          data_source: dataSource,
          tool_id: toolId,
        },
      },
    });

    if (useEnvVar) {
      // Use environment variable - store the env var name, clear any stored key
      const envVarName = toolDef.apiKeyEnvVar || `${toolId.toUpperCase()}_API_KEY`;

      if (config) {
        config = await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: {
            api_key_env_var: envVarName,
            api_key_encrypted: null,
          },
        });
      } else {
        config = await prisma.dataSourceToolConfig.create({
          data: {
            organization_id: orgId,
            data_source: dataSource,
            tool_id: toolId,
            tool_name: toolDef.name,
            enabled: toolDef.defaultEnabled,
            api_timeout_ms: toolDef.defaultTimeoutMs,
            severity_threshold: toolDef.defaultSeverityThreshold,
            lookback_hours: toolDef.defaultLookbackHours,
            config: getDefaultToolConfig(toolDef),
            api_key_env_var: envVarName,
            api_key_encrypted: null,
            description: toolDef.description,
            documentation_url: toolDef.documentationUrl ?? null,
          },
        });
      }

      res.status(200).json({
        success: true,
        data: {
          message: 'API key configured to use environment variable',
          envVar: envVarName,
          isConfigured: !!process.env[envVarName],
        },
      });
      return;
    }

    if (apiKey) {
      // Store the API key directly (base64 encoded for basic obfuscation)
      const encodedKey = Buffer.from(apiKey).toString('base64');

      if (config) {
        config = await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: {
            api_key_encrypted: encodedKey,
            api_key_env_var: null,
          },
        });
      } else {
        config = await prisma.dataSourceToolConfig.create({
          data: {
            organization_id: orgId,
            data_source: dataSource,
            tool_id: toolId,
            tool_name: toolDef.name,
            enabled: toolDef.defaultEnabled,
            api_timeout_ms: toolDef.defaultTimeoutMs,
            severity_threshold: toolDef.defaultSeverityThreshold,
            lookback_hours: toolDef.defaultLookbackHours,
            config: getDefaultToolConfig(toolDef),
            api_key_env_var: null,
            api_key_encrypted: encodedKey,
            description: toolDef.description,
            documentation_url: toolDef.documentationUrl ?? null,
          },
        });
      }

      res.status(200).json({
        success: true,
        data: {
          message: 'API key saved successfully',
          isConfigured: true,
        },
      });
      return;
    }

    // Clear API key
    if (config) {
      await prisma.dataSourceToolConfig.update({
        where: { id: config.id },
        data: {
          api_key_encrypted: null,
          api_key_env_var: null,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        message: 'API key cleared',
        isConfigured: false,
      },
    });
  } catch (error) {
    console.error('Save API key error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
