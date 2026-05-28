/**
 * Monitoring Config API Endpoint
 *
 * GET /api/monitoring/config?organizationId=xxx - Get monitoring config
 * PATCH /api/monitoring/config - Update monitoring config
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient, type Prisma } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and PATCH requests are supported' },
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

    if (req.method === 'GET') {
      const organizationId = req.query.organizationId as string;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'organizationId is required' },
        });
        return;
      }

      // Check user has access to organization
      const accessResult = await checkOrganizationAccess(tokenPayload.userId, organizationId);

      if (!accessResult.hasAccess) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied to organization' },
        });
        return;
      }

      // Get organization context (contains some config)
      const orgContext = await prisma.organizationContext.findUnique({
        where: { organization_id: organizationId },
      });

      // Return config with defaults
      const config = {
        organizationId,
        pollingIntervalMs: parseInt(process.env.MONITORING_DEFAULT_INTERVAL_MS || '15000', 10),
        enabledSources: {
          weather: true,
          political: true,
          cybersecurity: true,
          economic: true,
          news: true,
          maritime: true,
          labor: true,
          regulatory: true,
          pandemic: true,
          geopolitical: true,
        },
        geographicFilter: {
          radiusKm: orgContext?.geographic_radius_km || 100,
          strictMode: false,
        },
        riskFilter: {
          severityThreshold: orgContext?.severity_threshold || 0.5,
          confidenceThreshold: 0.3,
          monitoredRiskTypes: orgContext?.monitored_risk_types || [],
        },
        deduplication: {
          lookbackWindowHours: 168,
          enabled: true,
        },
        errorHandling: {
          maxBackoffMs: 60000,
          maxRetries: 3,
          stopOnFatalError: true,
        },
        observability: {
          enableMetrics: true,
          enableAuditLog: true,
          logLevel: process.env.LOG_LEVEL || 'info',
        },
      };

      res.status(200).json({ success: true, data: config });
      return;
    }

    // PATCH
    const { organizationId, geographicFilter, riskFilter } = req.body;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'organizationId is required' },
      });
      return;
    }

    // Check user has admin access to organization
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, organizationId);

    if (!accessResult.hasAccess || !['OWNER', 'ADMIN'].includes(accessResult.membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      });
      return;
    }

    // Update organization context with config values
    const updateData: Prisma.OrganizationContextUpdateInput = {};

    if (geographicFilter?.radiusKm !== undefined) {
      updateData.geographic_radius_km = geographicFilter.radiusKm;
    }
    if (riskFilter?.severityThreshold !== undefined) {
      updateData.severity_threshold = riskFilter.severityThreshold;
    }
    if (riskFilter?.monitoredRiskTypes !== undefined) {
      updateData.monitored_risk_types = riskFilter.monitoredRiskTypes;
    }

    // Upsert organization context
    const updatedContext = await prisma.organizationContext.upsert({
      where: { organization_id: organizationId },
      create: {
        organization: { connect: { id: organizationId } },
        geographic_radius_km: geographicFilter?.radiusKm || 100,
        severity_threshold: riskFilter?.severityThreshold || 0.5,
        monitored_risk_types: riskFilter?.monitoredRiskTypes || [],
        plants: [],
        warehouses: [],
        suppliers: [],
        shipping_lanes: [],
      },
      update: updateData,
    });

    // Return full config
    const config = {
      organizationId,
      pollingIntervalMs: parseInt(process.env.MONITORING_DEFAULT_INTERVAL_MS || '15000', 10),
      enabledSources: {
        weather: true,
        political: true,
        cybersecurity: true,
        economic: true,
        news: true,
        maritime: true,
        labor: true,
        regulatory: true,
        pandemic: true,
        geopolitical: true,
      },
      geographicFilter: {
        radiusKm: updatedContext.geographic_radius_km,
        strictMode: false,
      },
      riskFilter: {
        severityThreshold: updatedContext.severity_threshold,
        confidenceThreshold: 0.3,
        monitoredRiskTypes: updatedContext.monitored_risk_types,
      },
      deduplication: {
        lookbackWindowHours: 168,
        enabled: true,
      },
      errorHandling: {
        maxBackoffMs: 60000,
        maxRetries: 3,
        stopOnFatalError: true,
      },
      observability: {
        enableMetrics: true,
        enableAuditLog: true,
        logLevel: process.env.LOG_LEVEL || 'info',
      },
    };

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error('Monitoring config endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
