/**
 * Shipments API Endpoint
 *
 * GET /api/shipments?organizationId=xxx - List shipments for an organization
 * POST /api/shipments - Create a new shipment
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest } from '../../src/auth/index.js';
import { handleCorsPreflightAndSetHeaders } from '../_cors.js';

const prisma = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatShipment(s: any) {
  return {
    id: s.id,
    organizationId: s.organization_id,
    supplierId: s.supplier_id,
    carrierId: s.carrier_id,
    supplier: s.supplier ? { id: s.supplier.id, name: s.supplier.name, country: s.supplier.country, address: s.supplier.address } : null,
    carrier: s.carrier ? { id: s.carrier.id, name: s.carrier.name, scacCode: s.carrier.scac_code } : null,
    bolNumber: s.bol_number,
    masterBolNumber: s.master_bol_number,
    containersCount: s.containers_count,
    shippingRoute: s.shipping_route,
    valueUsd: s.value_usd,
    arrivalDate: s.arrival_date?.toISOString() || null,
    estimatedArrivalDate: s.estimated_arrival_date?.toISOString() || null,
    destinationPort: s.destination_port,
    destinationPortCode: s.destination_port_code,
    departurePort: s.departure_port,
    departurePortCode: s.departure_port_code,
    lastVisitForeignPort: s.last_visit_foreign_port,
    vesselName: s.vessel_name,
    vesselCode: s.vessel_code,
    voyage: s.voyage,
    containerIds: s.container_ids,
    containerSizes: s.container_sizes,
    containerTypes: s.container_types,
    hsCodes: s.hs_codes,
    hsCodeDescriptions: s.hs_code_descriptions,
    productDescription: s.product_description,
    productDescriptionRaw: s.product_description_raw,
    quantity: s.quantity,
    quantityUnit: s.quantity_unit,
    teu: s.teu,
    weight: s.weight,
    marksNumbers: s.marks_numbers,
    marksNumbersRaw: s.marks_numbers_raw,
    notifyPartyName: s.notify_party_name,
    notifyPartyAddress: s.notify_party_address,
    notifyPartyCountryCode: s.notify_party_country_code,
    createdAt: s.created_at.toISOString(),
    updatedAt: s.updated_at.toISOString(),
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Handle CORS
  if (handleCorsPreflightAndSetHeaders(req, res)) return;

  try {
    // Authenticate request
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
          error: { code: 'VALIDATION_ERROR', message: 'organizationId query parameter is required' },
        });
        return;
      }

      // Verify user has access to this organization
      const membership = await prisma.userOrganization.findUnique({
        where: {
          user_id_organization_id: {
            user_id: tokenPayload.userId,
            organization_id: organizationId,
          },
        },
      });

      if (membership?.status !== 'active') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied to this organization' },
        });
        return;
      }

      const shipments = await prisma.shipment.findMany({
        where: { organization_id: organizationId },
        include: {
          supplier: { select: { id: true, name: true, country: true } },
          carrier: { select: { id: true, name: true, scac_code: true } },
        },
        orderBy: { arrival_date: 'desc' },
      });

      res.status(200).json({
        success: true,
        data: shipments.map(formatShipment),
      });
      return;
    }

    if (req.method === 'POST') {
      const {
        organizationId,
        bolNumber,
        masterBolNumber,
        supplierId,
        carrierId,
        containersCount,
        shippingRoute,
        valueUsd,
        arrivalDate,
        estimatedArrivalDate,
        destinationPort,
        destinationPortCode,
        departurePort,
        departurePortCode,
        vesselName,
        vesselCode,
        voyage,
        containerIds,
        containerSizes,
        containerTypes,
        hsCodes,
        hsCodeDescriptions,
        productDescription,
        quantity,
        quantityUnit,
        teu,
        weight,
        notifyPartyName,
        notifyPartyAddress,
        notifyPartyCountryCode,
      } = req.body;

      if (!organizationId || !bolNumber) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'organizationId and bolNumber are required' },
        });
        return;
      }

      // Verify user has write access
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
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
        });
        return;
      }

      const shipment = await prisma.shipment.create({
        data: {
          id: crypto.randomUUID(),
          organization: { connect: { id: organizationId } },
          bol_number: bolNumber,
          master_bol_number: masterBolNumber,
          supplier_id: supplierId,
          carrier_id: carrierId,
          containers_count: containersCount,
          shipping_route: shippingRoute,
          value_usd: valueUsd,
          arrival_date: arrivalDate ? new Date(arrivalDate) : null,
          estimated_arrival_date: estimatedArrivalDate ? new Date(estimatedArrivalDate) : null,
          destination_port: destinationPort,
          destination_port_code: destinationPortCode,
          departure_port: departurePort,
          departure_port_code: departurePortCode,
          vessel_name: vesselName,
          vessel_code: vesselCode,
          voyage,
          container_ids: containerIds,
          container_sizes: containerSizes,
          container_types: containerTypes,
          hs_codes: hsCodes,
          hs_code_descriptions: hsCodeDescriptions,
          product_description: productDescription,
          quantity,
          quantity_unit: quantityUnit,
          teu,
          weight,
          notify_party_name: notifyPartyName,
          notify_party_address: notifyPartyAddress,
          notify_party_country_code: notifyPartyCountryCode,
        },
        include: {
          supplier: { select: { id: true, name: true, country: true, address: true } },
          carrier: { select: { id: true, name: true, scac_code: true } },
        },
      });

      res.status(201).json({
        success: true,
        data: formatShipment(shipment),
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST requests are supported' },
    });
  } catch (error) {
    console.error('Shipments endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
