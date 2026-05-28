/**
 * Single Shipment API Endpoint
 *
 * GET /api/shipments/:id - Get shipment details
 * PATCH /api/shipments/:id - Update shipment
 * DELETE /api/shipments/:id - Delete shipment
 * Auth: Bearer token required
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { authenticateRequest, checkOrganizationAccess } from '../../src/auth/index.js';
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

    const shipmentId = req.query.id as string;

    if (!shipmentId) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Shipment ID is required' },
      });
      return;
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        supplier: { select: { id: true, name: true, country: true, address: true } },
        carrier: { select: { id: true, name: true, scac_code: true } },
      },
    });

    if (!shipment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Shipment not found' },
      });
      return;
    }

    // Verify user has access to this organization
    const accessResult = await checkOrganizationAccess(tokenPayload.userId, shipment.organization_id);

    if (!accessResult.hasAccess) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Shipment not found' },
      });
      return;
    }

    if (req.method === 'GET') {
      res.status(200).json({
        success: true,
        data: formatShipment(shipment),
      });
      return;
    }

    // Write operations require OWNER or ADMIN
    if (!['OWNER', 'ADMIN'].includes(accessResult.membership.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
      return;
    }

    if (req.method === 'PATCH') {
      const {
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

      const updated = await prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          ...(bolNumber !== undefined && { bol_number: bolNumber }),
          ...(masterBolNumber !== undefined && { master_bol_number: masterBolNumber }),
          ...(supplierId !== undefined && { supplier_id: supplierId }),
          ...(carrierId !== undefined && { carrier_id: carrierId }),
          ...(containersCount !== undefined && { containers_count: containersCount }),
          ...(shippingRoute !== undefined && { shipping_route: shippingRoute }),
          ...(valueUsd !== undefined && { value_usd: valueUsd }),
          ...(arrivalDate !== undefined && { arrival_date: arrivalDate ? new Date(arrivalDate) : null }),
          ...(estimatedArrivalDate !== undefined && { estimated_arrival_date: estimatedArrivalDate ? new Date(estimatedArrivalDate) : null }),
          ...(destinationPort !== undefined && { destination_port: destinationPort }),
          ...(destinationPortCode !== undefined && { destination_port_code: destinationPortCode }),
          ...(departurePort !== undefined && { departure_port: departurePort }),
          ...(departurePortCode !== undefined && { departure_port_code: departurePortCode }),
          ...(vesselName !== undefined && { vessel_name: vesselName }),
          ...(vesselCode !== undefined && { vessel_code: vesselCode }),
          ...(voyage !== undefined && { voyage }),
          ...(containerIds !== undefined && { container_ids: containerIds }),
          ...(containerSizes !== undefined && { container_sizes: containerSizes }),
          ...(containerTypes !== undefined && { container_types: containerTypes }),
          ...(hsCodes !== undefined && { hs_codes: hsCodes }),
          ...(hsCodeDescriptions !== undefined && { hs_code_descriptions: hsCodeDescriptions }),
          ...(productDescription !== undefined && { product_description: productDescription }),
          ...(quantity !== undefined && { quantity }),
          ...(quantityUnit !== undefined && { quantity_unit: quantityUnit }),
          ...(teu !== undefined && { teu }),
          ...(weight !== undefined && { weight }),
          ...(notifyPartyName !== undefined && { notify_party_name: notifyPartyName }),
          ...(notifyPartyAddress !== undefined && { notify_party_address: notifyPartyAddress }),
          ...(notifyPartyCountryCode !== undefined && { notify_party_country_code: notifyPartyCountryCode }),
        },
        include: {
          supplier: { select: { id: true, name: true, country: true, address: true } },
          carrier: { select: { id: true, name: true, scac_code: true } },
        },
      });

      res.status(200).json({
        success: true,
        data: formatShipment(updated),
      });
      return;
    }

    if (req.method === 'DELETE') {
      await prisma.shipment.delete({ where: { id: shipmentId } });

      res.status(200).json({
        success: true,
        data: { message: 'Shipment deleted successfully' },
      });
      return;
    }

    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET, PATCH, and DELETE requests are supported' },
    });
  } catch (error) {
    console.error('Shipment endpoint error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  }
}
