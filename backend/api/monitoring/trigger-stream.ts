/**
 * Monitoring Trigger Stream API Endpoint (SSE)
 *
 * GET /api/monitoring/trigger-stream?organizationId=xxx
 * Auth: Bearer token required (ADMIN or OWNER)
 *
 * Streams progress updates via Server-Sent Events while running a monitoring cycle.
 *
 * Vercel Serverless Function with streaming support.
 * Note: Function timeout applies (60s on Pro, 10s on Hobby).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../src/auth/index.js';

const prisma = new PrismaClient();

// Enable response streaming for Vercel
export const config = {
  supportsResponseStreaming: true,
  maxDuration: 300, // Maximum duration in seconds (Pro plan allows up to 300s for streaming)
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS manually for SSE
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:4111',
    'https://pericles.cloud',
    'https://www.pericles.cloud',
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).end();
    return;
  }

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

    const organizationId = req.query.organizationId as string;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'organizationId is required' },
      });
      return;
    }

    // Check user has admin access to organization
    const membership = await prisma.userOrganization.findUnique({
      where: {
        user_id_organization_id: {
          user_id: tokenPayload.userId,
          organization_id: organizationId,
        },
      },
    });

    if (membership?.status !== 'active' || !['OWNER', 'ADMIN'].includes(membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required to trigger monitoring' },
      });
      return;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/proxy buffering

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Stream connected', timestamp: new Date().toISOString() })}\n\n`);

    // Run monitoring cycle with progress updates
    try {
      // Dynamic import to avoid circular dependencies
      const { loadMonitoringConfig, getEnvironmentOverrides } = await import('../../src/monitoring/config.js');
      const { runMonitoringCycle } = await import('../../src/monitoring/index.js');

      // Progress callback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onProgress = (update: any) => {
        try {
          res.write(`data: ${JSON.stringify({ type: 'progress', ...update })}\n\n`);
        } catch {
          // Client may have disconnected - ignore
        }
      };

      // Load config
      const envOverrides = getEnvironmentOverrides();
      const config = await loadMonitoringConfig(organizationId, envOverrides);

      // Run the monitoring cycle
      const metrics = await runMonitoringCycle(config, onProgress);

      // Send final metrics
      res.write(`data: ${JSON.stringify({
        type: 'complete',
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
      })}\n\n`);
    } catch (error) {
      console.error('Monitoring cycle error:', error);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: (error as Error).message || 'Monitoring cycle failed',
        timestamp: new Date().toISOString(),
      })}\n\n`);
    }

    // Close the stream
    res.end();
  } catch (error) {
    console.error('Trigger monitoring stream error:', error);

    // If headers not sent yet, send JSON error
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: (error as Error).message || 'Failed to start monitoring stream',
        },
      });
    } else {
      res.end();
    }
  }
}
