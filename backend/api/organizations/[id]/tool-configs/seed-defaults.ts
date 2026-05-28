/**
 * Seed Default Tool Configs API Endpoint
 *
 * POST /api/organizations/:id/tool-configs/seed-defaults - Seed default configs for all tools
 * Auth: Bearer token required (ADMIN or OWNER)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../../../_cors.js';
import { DATA_SOURCE_DEFINITIONS, getDefaultToolConfig } from '../../../../src/monitoring/tool-configs.js';

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

    // Require ADMIN or OWNER
    if (!['OWNER', 'ADMIN'].includes(accessResult.membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to seed tool configurations' },
      });
      return;
    }

    const { overwrite } = req.body;
    const created: string[] = [];
    const skipped: string[] = [];

    for (const dataSource of DATA_SOURCE_DEFINITIONS) {
      for (const tool of dataSource.tools) {
        const existing = await prisma.dataSourceToolConfig.findUnique({
          where: {
            organization_id_data_source_tool_id: {
              organization_id: orgId,
              data_source: dataSource.id,
              tool_id: tool.id,
            },
          },
        });

        if (existing && !overwrite) {
          skipped.push(`${dataSource.id}/${tool.id}`);
          continue;
        }

        await prisma.dataSourceToolConfig.upsert({
          where: {
            organization_id_data_source_tool_id: {
              organization_id: orgId,
              data_source: dataSource.id,
              tool_id: tool.id,
            },
          },
          create: {
            organization_id: orgId,
            data_source: dataSource.id,
            tool_id: tool.id,
            tool_name: tool.name,
            enabled: tool.defaultEnabled,
            api_timeout_ms: tool.defaultTimeoutMs,
            severity_threshold: tool.defaultSeverityThreshold,
            lookback_hours: tool.defaultLookbackHours,
            config: getDefaultToolConfig(tool),
            api_key_env_var: tool.apiKeyEnvVar ?? null,
            description: tool.description,
            documentation_url: tool.documentationUrl ?? null,
          },
          update: overwrite
            ? {
                tool_name: tool.name,
                enabled: tool.defaultEnabled,
                api_timeout_ms: tool.defaultTimeoutMs,
                severity_threshold: tool.defaultSeverityThreshold,
                lookback_hours: tool.defaultLookbackHours,
                config: getDefaultToolConfig(tool),
                api_key_env_var: tool.apiKeyEnvVar ?? null,
                description: tool.description,
                documentation_url: tool.documentationUrl ?? null,
              }
            : {},
        });

        created.push(`${dataSource.id}/${tool.id}`);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        message: 'Default tool configurations seeded',
        created: created.length,
        skipped: skipped.length,
        tools: { created, skipped },
      },
    });
  } catch (error) {
    console.error('Seed tool configs error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
