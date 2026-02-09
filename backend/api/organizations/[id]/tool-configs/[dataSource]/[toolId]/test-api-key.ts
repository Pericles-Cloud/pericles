/**
 * Test API Key Endpoint
 *
 * POST /api/organizations/:id/tool-configs/:dataSource/:toolId/test-api-key - Test API key for a tool
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
    const dataSource = req.query.dataSource as string;
    const toolId = req.query.toolId as string;
    const { apiKey } = req.body; // Optional - if not provided, use stored key

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

    // Get the API key to test
    let testKey = apiKey;
    if (!testKey) {
      // Try to get from stored config or environment
      const config = await prisma.dataSourceToolConfig.findUnique({
        where: {
          organization_id_data_source_tool_id: {
            organization_id: orgId,
            data_source: dataSource,
            tool_id: toolId,
          },
        },
      });

      if (config?.api_key_encrypted) {
        testKey = Buffer.from(config.api_key_encrypted, 'base64').toString('utf-8');
      } else if (config?.api_key_env_var) {
        testKey = process.env[config.api_key_env_var];
      } else if (toolDef.apiKeyEnvVar) {
        testKey = process.env[toolDef.apiKeyEnvVar];
      }
    }

    if (!testKey && toolDef.requiresApiKey) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_API_KEY', message: 'No API key provided or configured' },
      });
      return;
    }

    // Test the API key based on the tool type
    let testResult: { success: boolean; message: string; details?: string };

    try {
      switch (toolId) {
        case 'thenewsapi': {
          const response = await fetch(`https://api.thenewsapi.com/v1/news/all?api_token=${testKey}&limit=1`, {
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'TheNewsAPI key is valid' };
          } else if (response.status === 401 || response.status === 403) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'twitter': {
          const response = await fetch('https://api.twitterapi.io/twitter/user/details?userName=twitter', {
            headers: { 'X-API-Key': testKey || '' },
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'Twitter API.io key is valid' };
          } else if (response.status === 401 || response.status === 403) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'openweather': {
          const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${testKey}`, {
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'OpenWeather API key is valid' };
          } else if (response.status === 401) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'nvd': {
          // NVD works without a key but is rate-limited
          const url = 'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1';
          const headers: Record<string, string> = {};
          if (testKey) {
            headers.apiKey = testKey;
          }
          const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
          if (response.ok) {
            testResult = { success: true, message: testKey ? 'NVD API key is valid' : 'NVD API is accessible (no key required)' };
          } else if (response.status === 403) {
            testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        case 'fred': {
          const response = await fetch(`https://api.stlouisfed.org/fred/series?series_id=GNPCA&api_key=${testKey}&file_type=json`, {
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            testResult = { success: true, message: 'FRED API key is valid' };
          } else if (response.status === 400) {
            const data = await response.json().catch(() => ({}));
            if (data.error_message?.includes('api_key')) {
              testResult = { success: false, message: 'Invalid API key', details: 'Authentication failed' };
            } else {
              testResult = { success: false, message: `API error: ${data.error_message || 'Unknown error'}` };
            }
          } else {
            testResult = { success: false, message: `API returned status ${response.status}` };
          }
          break;
        }

        default:
          // For tools without specific test endpoints, just verify the key exists
          if (!toolDef.requiresApiKey) {
            testResult = { success: true, message: 'This tool does not require an API key' };
          } else if (testKey) {
            testResult = { success: true, message: 'API key is configured (unable to verify with API)' };
          } else {
            testResult = { success: false, message: 'No API key configured' };
          }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        testResult = { success: false, message: 'API request timed out' };
      } else {
        testResult = { success: false, message: 'Failed to connect to API', details: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // Update last test status in database if we have a config
    const config = await prisma.dataSourceToolConfig.findUnique({
      where: {
        organization_id_data_source_tool_id: {
          organization_id: orgId,
          data_source: dataSource,
          tool_id: toolId,
        },
      },
    });

    if (config) {
      if (testResult.success) {
        await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: { last_success_at: new Date(), last_error_at: null, last_error_message: null },
        });
      } else {
        await prisma.dataSourceToolConfig.update({
          where: { id: config.id },
          data: { last_error_at: new Date(), last_error_message: testResult.message },
        });
      }
    }

    res.status(200).json({
      success: true,
      data: testResult,
    });
  } catch (error) {
    console.error('Test API key error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
