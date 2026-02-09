/**
 * Data Sources API Endpoint
 *
 * GET /api/data-sources - Get available data source definitions (public, no auth required)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';
import { DATA_SOURCE_DEFINITIONS } from '../../src/monitoring/tool-configs.js';

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

  res.status(200).json({ success: true, data: DATA_SOURCE_DEFINITIONS });
}
