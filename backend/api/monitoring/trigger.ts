/**
 * Monitoring Trigger API Endpoint (Vercel Serverless)
 *
 * POST /api/monitoring/trigger
 * Body: { organization_id: string }
 * Auth: Bearer token required
 *
 * This endpoint executes a SINGLE monitoring cycle (not continuous).
 * Use for:
 * - Vercel Cron jobs (minimum 1-minute interval)
 * - Manual triggering
 * - Testing
 *
 * For continuous 15-second polling, use the standalone Node process (start.ts)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadMonitoringConfig, getEnvironmentOverrides } from '../../src/monitoring/config';
import { runMonitoringCycle } from '../../src/monitoring/index';
import { logger } from '../../src/monitoring/logger';

/**
 * Authenticate request using Bearer token
 */
function authenticateRequest(req: VercelRequest): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  const validToken = process.env.MONITORING_API_TOKEN;

  if (!validToken) {
    logger.warn('[API] MONITORING_API_TOKEN not set, skipping authentication');
    return true; // Allow in development
  }

  return token === validToken;
}

/**
 * Main request handler
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).json({});
    return;
  }

  // Only accept POST
  if (req.method !== 'POST') {
    res.status(405).json({
      error: 'Method not allowed',
      message: 'Only POST requests are supported',
    });
    return;
  }

  // Authenticate
  if (!authenticateRequest(req)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing Bearer token',
    });
    return;
  }

  // Extract organization_id
  const { organization_id } = req.body;

  if (!organization_id) {
    res.status(400).json({
      error: 'Bad request',
      message: 'organization_id is required in request body',
    });
    return;
  }

  logger.info({ organizationId: organization_id }, '[API] Monitoring cycle triggered');

  try {
    // Load configuration
    const envOverrides = getEnvironmentOverrides();
    const config = await loadMonitoringConfig(organization_id, envOverrides);

    // Execute single monitoring cycle
    const metrics = await runMonitoringCycle(config);

    // Return metrics
    res.status(200).json({
      success: true,
      organizationId: organization_id,
      metrics: {
        durationMs: metrics.durationMs,
        eventsDetected: metrics.eventsDetected,
        eventsPublished: metrics.eventsPublished,
        duplicatesFiltered: metrics.duplicatesFiltered,
        geographyFiltered: metrics.geographyFiltered,
        severityFiltered: metrics.severityFiltered,
        toolsExecuted: metrics.toolsExecuted,
        toolsSucceeded: metrics.toolsSucceeded,
        toolsFailed: metrics.toolsFailed,
        errorCount: metrics.errors.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error, organizationId: organization_id }, '[API] Monitoring cycle failed');

    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
      organizationId: organization_id,
    });
  }
}
