import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Exposure Pathway Evaluator Tool
 *
 * Purpose: Evaluate all 7 exposure pathways against a Global Event and Client Exposure Profile.
 *
 * Pathways:
 * 1. Geographic: sites (facilities, suppliers, customers within buffer)
 * 2. Geographic: flows (ports, airports, chokepoints on routes)
 * 3. Entity (named organizations match suppliers/carriers/customers)
 * 4. Product and commodity (HS codes, BOM inputs affected)
 * 5. Regulatory (sanctions, export controls, tariffs apply)
 * 6. Indirect tier-N (region/industry dependencies)
 * 7. Strategic (initiatives, markets, partners)
 */
export const exposurePathwayEvaluatorTool = createTool({
  id: 'exposure-pathway-evaluator-tool',
  description: `
Evaluate all 7 exposure pathways for a Global Event against a Client Exposure Profile.

Returns matches for each pathway with confidence scores and match basis.
Use this AFTER loading the Client Exposure Profile.
`,
  inputSchema: z.object({
    // Global Event data
    global_event_id: z.string().uuid(),
    event_category: z.string(),
    event_subcategory: z.string().optional(),
    event_status: z.string(),
    intrinsic_severity: z.string(),
    event_latitude: z.number().nullable(),
    event_longitude: z.number().nullable(),
    affected_area: z.object({
      radius_km: z.number().optional(),
      polygon: z.array(z.array(z.number())).optional(),
    }).nullable().optional(),
    country_iso: z.string().nullable().optional(),
    admin1_region: z.string().nullable().optional(),
    named_infrastructure: z.array(z.object({
      type: z.enum(['port', 'airport', 'chokepoint', 'canal', 'industrial_park']),
      code: z.string().optional(),
      name: z.string(),
    })).nullable().optional(),
    affected_dimensions: z.object({
      transport_modes: z.array(z.string()).optional(),
      commodities: z.array(z.object({
        hs_chapter: z.string().optional(),
        name: z.string().optional(),
      })).optional(),
      industries: z.array(z.string()).optional(),
      organizations: z.array(z.object({
        name: z.string(),
        lei: z.string().optional(),
      })).optional(),
    }).nullable().optional(),
    event_window_start: z.string().datetime().nullable().optional(),
    event_window_end: z.string().datetime().nullable().optional(),

    // Client Exposure Profile (from clientExposureProfileTool)
    profile: z.object({
      organization_id: z.string(),
      profile_version: z.number(),
      own_facilities: z.array(z.any()),
      suppliers: z.array(z.any()),
      products: z.array(z.any()),
      logistics: z.object({
        carriers: z.array(z.any()),
        routes: z.array(z.any()),
      }),
      shipments_in_transit: z.array(z.any()),
      customers: z.array(z.any()),
      strategic_priorities: z.any().nullable(),
      buffer_distances: z.record(z.number()).nullable(),
      excluded_categories: z.array(z.string()),
      excluded_regions: z.array(z.string()),
      min_severity: z.record(z.string()).nullable(),
    }),
  }),
  outputSchema: z.object({
    global_event_id: z.string(),
    organization_id: z.string(),

    // Pathway matches
    pathway_matches: z.array(z.object({
      pathway: z.enum([
        'geographic_site',
        'geographic_flow',
        'entity',
        'product',
        'regulatory',
        'indirect',
        'strategic',
      ]),
      matched: z.boolean(),
      confidence: z.number().min(0).max(1),
      match_basis: z.string(),
      exposed_assets: z.array(z.object({
        asset_type: z.enum(['facility', 'supplier', 'shipment', 'sku', 'carrier', 'lane', 'customer']),
        asset_id: z.string(),
        asset_name: z.string(),
        distance_or_match_basis: z.string(),
      })),
    })),

    // Overall assessment
    exposure_strength: z.enum(['direct', 'probable', 'possible', 'strategic', 'none']),
    exposure_priority: z.enum(['critical', 'high', 'medium', 'low']),
    rationale: z.string(),

    // Admin filter results
    filtered_out: z.boolean(),
    filter_reason: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    const {
      global_event_id,
      event_category,
      intrinsic_severity,
      event_latitude,
      event_longitude,
      affected_area,
      country_iso,
      named_infrastructure,
      affected_dimensions,
      event_window_start,
      event_window_end,
      profile,
    } = context;

    const organization_id = profile.organization_id;
    const pathwayMatches: any[] = [];

    // Check admin filters first
    const filteredOut = checkAdminFilters(event_category, country_iso, intrinsic_severity, profile);
    if (filteredOut.filtered) {
      return {
        global_event_id,
        organization_id,
        pathway_matches: [],
        exposure_strength: 'none' as const,
        exposure_priority: 'low' as const,
        rationale: `Filtered out: ${filteredOut.reason}`,
        filtered_out: true,
        filter_reason: filteredOut.reason,
      };
    }

    // Get buffer distance for this category
    const defaultBuffers: Record<string, number> = {
      'Meteorological / Natural Hazard': 200,
      'Geopolitical / Conflict': 100,
      'Labor': 50,
      'Logistics & Infrastructure': 100,
      'Industrial / Facility': 25,
      'Cyber': 0, // Entity-based, not geographic
      'Public Health': 150,
    };
    const bufferKm = profile.buffer_distances?.[event_category] ??
      defaultBuffers[event_category] ?? 100;

    // 1. Geographic: sites
    const siteMatches = evaluateGeographicSites(
      event_latitude,
      event_longitude,
      affected_area?.radius_km ?? bufferKm,
      profile.own_facilities,
      profile.suppliers,
      profile.customers
    );
    pathwayMatches.push({
      pathway: 'geographic_site',
      matched: siteMatches.length > 0,
      confidence: siteMatches.length > 0 ? Math.min(0.95, 0.5 + siteMatches.length * 0.1) : 0,
      match_basis: siteMatches.length > 0
        ? `${siteMatches.length} site(s) within ${bufferKm}km of event`
        : 'No sites within buffer distance',
      exposed_assets: siteMatches,
    });

    // 2. Geographic: flows
    const flowMatches = evaluateGeographicFlows(
      named_infrastructure,
      country_iso,
      profile.logistics.routes,
      profile.shipments_in_transit,
      event_window_start,
      event_window_end
    );
    pathwayMatches.push({
      pathway: 'geographic_flow',
      matched: flowMatches.length > 0,
      confidence: flowMatches.length > 0 ? Math.min(0.9, 0.4 + flowMatches.length * 0.15) : 0,
      match_basis: flowMatches.length > 0
        ? `${flowMatches.length} route/shipment(s) through affected infrastructure`
        : 'No routes through affected infrastructure',
      exposed_assets: flowMatches,
    });

    // 3. Entity
    const entityMatches = evaluateEntityPathway(
      affected_dimensions?.organizations,
      profile.suppliers,
      profile.logistics.carriers,
      profile.customers
    );
    pathwayMatches.push({
      pathway: 'entity',
      matched: entityMatches.length > 0,
      confidence: entityMatches.length > 0 ? Math.min(0.95, 0.6 + entityMatches.length * 0.1) : 0,
      match_basis: entityMatches.length > 0
        ? `${entityMatches.length} entity match(es)`
        : 'No entity matches',
      exposed_assets: entityMatches,
    });

    // 4. Product and commodity
    const productMatches = evaluateProductPathway(
      affected_dimensions?.commodities,
      profile.products,
      profile.suppliers
    );
    pathwayMatches.push({
      pathway: 'product',
      matched: productMatches.length > 0,
      confidence: productMatches.length > 0 ? Math.min(0.85, 0.5 + productMatches.length * 0.1) : 0,
      match_basis: productMatches.length > 0
        ? `${productMatches.length} product/commodity match(es)`
        : 'No product matches',
      exposed_assets: productMatches,
    });

    // 5. Regulatory
    const regulatoryMatches = evaluateRegulatoryPathway(
      event_category,
      country_iso,
      affected_dimensions,
      profile.suppliers,
      profile.logistics.routes
    );
    pathwayMatches.push({
      pathway: 'regulatory',
      matched: regulatoryMatches.length > 0,
      confidence: regulatoryMatches.length > 0 ? Math.min(0.9, 0.5 + regulatoryMatches.length * 0.15) : 0,
      match_basis: regulatoryMatches.length > 0
        ? `${regulatoryMatches.length} regulatory exposure(s)`
        : 'No regulatory exposure',
      exposed_assets: regulatoryMatches,
    });

    // 6. Indirect (tier-N)
    const indirectMatches = evaluateIndirectPathway(
      event_category,
      country_iso,
      affected_dimensions?.industries,
      profile.suppliers
    );
    pathwayMatches.push({
      pathway: 'indirect',
      matched: indirectMatches.length > 0,
      confidence: indirectMatches.length > 0 ? Math.min(0.7, 0.3 + indirectMatches.length * 0.1) : 0,
      match_basis: indirectMatches.length > 0
        ? `${indirectMatches.length} potential tier-N exposure(s)`
        : 'No tier-N exposure identified',
      exposed_assets: indirectMatches,
    });

    // 7. Strategic
    const strategicMatches = evaluateStrategicPathway(
      country_iso,
      affected_dimensions,
      profile.strategic_priorities
    );
    pathwayMatches.push({
      pathway: 'strategic',
      matched: strategicMatches.length > 0,
      confidence: strategicMatches.length > 0 ? 0.6 : 0,
      match_basis: strategicMatches.length > 0
        ? `${strategicMatches.length} strategic initiative(s) affected`
        : 'No strategic initiatives affected',
      exposed_assets: strategicMatches,
    });

    // Determine overall exposure strength
    const { exposureStrength, exposurePriority, rationale } = classifyExposure(
      pathwayMatches,
      intrinsic_severity
    );

    return {
      global_event_id,
      organization_id,
      pathway_matches: pathwayMatches,
      exposure_strength: exposureStrength,
      exposure_priority: exposurePriority,
      rationale,
      filtered_out: false,
      filter_reason: null,
    };
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

function checkAdminFilters(
  category: string,
  countryIso: string | null | undefined,
  severity: string,
  profile: any
): { filtered: boolean; reason: string | null } {
  // Check excluded categories
  if (profile.excluded_categories?.includes(category)) {
    return { filtered: true, reason: `Category '${category}' is excluded by admin config` };
  }

  // Check excluded regions
  if (countryIso && profile.excluded_regions?.includes(countryIso)) {
    return { filtered: true, reason: `Region '${countryIso}' is excluded by admin config` };
  }

  // Check minimum severity
  const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  const minSeverity = profile.min_severity?.[category] ?? 'low';
  const eventSeverityValue = severityOrder[severity as keyof typeof severityOrder] ?? 0;
  const minSeverityValue = severityOrder[minSeverity as keyof typeof severityOrder] ?? 0;

  if (eventSeverityValue < minSeverityValue) {
    return { filtered: true, reason: `Severity '${severity}' below minimum '${minSeverity}' for category` };
  }

  return { filtered: false, reason: null };
}

function evaluateGeographicSites(
  eventLat: number | null,
  eventLng: number | null,
  bufferKm: number,
  facilities: any[],
  suppliers: any[],
  customers: any[]
): any[] {
  if (eventLat === null || eventLng === null) return [];

  const matches: any[] = [];

  // Check facilities
  for (const facility of facilities) {
    if (facility.latitude !== null && facility.longitude !== null) {
      const distance = haversineDistance(eventLat, eventLng, facility.latitude, facility.longitude);
      if (distance <= bufferKm) {
        matches.push({
          asset_type: 'facility',
          asset_id: facility.id,
          asset_name: facility.name,
          distance_or_match_basis: `${distance.toFixed(0)}km from event (buffer: ${bufferKm}km)`,
        });
      }
    }
  }

  // Check suppliers
  for (const supplier of suppliers) {
    if (supplier.latitude !== null && supplier.longitude !== null) {
      const distance = haversineDistance(eventLat, eventLng, supplier.latitude, supplier.longitude);
      if (distance <= bufferKm) {
        matches.push({
          asset_type: 'supplier',
          asset_id: supplier.id,
          asset_name: supplier.name,
          distance_or_match_basis: `${distance.toFixed(0)}km from event (buffer: ${bufferKm}km)`,
        });
      }
    }
  }

  // Check customer locations
  for (const customer of customers) {
    for (const loc of customer.ship_to_locations ?? []) {
      const distance = haversineDistance(eventLat, eventLng, loc.latitude, loc.longitude);
      if (distance <= bufferKm) {
        matches.push({
          asset_type: 'customer',
          asset_id: customer.id,
          asset_name: customer.name,
          distance_or_match_basis: `${distance.toFixed(0)}km from event (buffer: ${bufferKm}km)`,
        });
      }
    }
  }

  return matches;
}

function evaluateGeographicFlows(
  namedInfrastructure: any[] | null | undefined,
  countryIso: string | null | undefined,
  routes: any[],
  shipments: any[],
  eventWindowStart: string | null | undefined,
  eventWindowEnd: string | null | undefined
): any[] {
  const matches: any[] = [];

  if (!namedInfrastructure || namedInfrastructure.length === 0) return matches;

  const affectedCodes = new Set(
    namedInfrastructure.map((i: any) => i.code?.toUpperCase()).filter(Boolean)
  );
  const affectedNames = new Set(
    namedInfrastructure.map((i: any) => i.name?.toLowerCase()).filter(Boolean)
  );

  // Check routes
  for (const route of routes) {
    const routePorts = (route.ports ?? []).map((p: string) => p.toUpperCase());
    const matchingPorts = routePorts.filter((p: string) => affectedCodes.has(p));
    if (matchingPorts.length > 0) {
      matches.push({
        asset_type: 'lane',
        asset_id: `${route.origin}-${route.destination}`,
        asset_name: `${route.origin} → ${route.destination}`,
        distance_or_match_basis: `Route passes through affected port(s): ${matchingPorts.join(', ')}`,
      });
    }
  }

  // Check shipments in transit
  for (const shipment of shipments) {
    const depCode = shipment.departure_port_code?.toUpperCase();
    const destCode = shipment.destination_port_code?.toUpperCase();

    if ((depCode && affectedCodes.has(depCode)) || (destCode && affectedCodes.has(destCode))) {
      // Check temporal relevance
      let temporalNote = '';
      if (shipment.eta && eventWindowStart && eventWindowEnd) {
        const eta = new Date(shipment.eta);
        const windowStart = new Date(eventWindowStart);
        const windowEnd = new Date(eventWindowEnd);
        if (eta >= windowStart && eta <= windowEnd) {
          temporalNote = ' (ETA within event window)';
        }
      }

      matches.push({
        asset_type: 'shipment',
        asset_id: shipment.id,
        asset_name: `${shipment.origin} → ${shipment.destination}`,
        distance_or_match_basis: `Shipment uses affected port${temporalNote}`,
      });
    }
  }

  return matches;
}

function evaluateEntityPathway(
  eventOrganizations: any[] | undefined,
  suppliers: any[],
  carriers: any[],
  customers: any[]
): any[] {
  if (!eventOrganizations || eventOrganizations.length === 0) return [];

  const matches: any[] = [];

  for (const eventOrg of eventOrganizations) {
    const eventOrgName = eventOrg.name?.toLowerCase() ?? '';
    const eventOrgLei = eventOrg.lei?.toUpperCase();

    // Check suppliers
    for (const supplier of suppliers) {
      const supplierName = supplier.name?.toLowerCase() ?? '';
      if (eventOrgName && (supplierName.includes(eventOrgName) || eventOrgName.includes(supplierName))) {
        matches.push({
          asset_type: 'supplier',
          asset_id: supplier.id,
          asset_name: supplier.name,
          distance_or_match_basis: `Name match with event organization: ${eventOrg.name}`,
        });
      }
    }

    // Check carriers
    for (const carrier of carriers) {
      const carrierName = carrier.name?.toLowerCase() ?? '';
      if (eventOrgName && (carrierName.includes(eventOrgName) || eventOrgName.includes(carrierName))) {
        matches.push({
          asset_type: 'carrier',
          asset_id: carrier.id,
          asset_name: carrier.name,
          distance_or_match_basis: `Name match with event organization: ${eventOrg.name}`,
        });
      }
    }

    // Check customers
    for (const customer of customers) {
      const customerName = customer.name?.toLowerCase() ?? '';
      if (eventOrgName && (customerName.includes(eventOrgName) || eventOrgName.includes(customerName))) {
        matches.push({
          asset_type: 'customer',
          asset_id: customer.id,
          asset_name: customer.name,
          distance_or_match_basis: `Name match with event organization: ${eventOrg.name}`,
        });
      }
    }
  }

  return matches;
}

function evaluateProductPathway(
  eventCommodities: any[] | undefined,
  products: any[],
  suppliers: any[]
): any[] {
  if (!eventCommodities || eventCommodities.length === 0) return [];

  const matches: any[] = [];
  const eventHsChapters = new Set(
    eventCommodities.map((c: any) => c.hs_chapter).filter(Boolean)
  );

  // Check products
  for (const product of products) {
    const productHsCodes = product.hs_codes ?? [];
    for (const hsCode of productHsCodes) {
      const chapter = hsCode.substring(0, 2);
      if (eventHsChapters.has(chapter)) {
        matches.push({
          asset_type: 'sku',
          asset_id: product.sku,
          asset_name: product.name ?? product.sku,
          distance_or_match_basis: `HS chapter ${chapter} affected by event`,
        });
        break;
      }
    }
  }

  // Check suppliers by commodity
  for (const supplier of suppliers) {
    for (const supply of supplier.supplies ?? []) {
      if (supply.hs_code) {
        const chapter = supply.hs_code.substring(0, 2);
        if (eventHsChapters.has(chapter)) {
          matches.push({
            asset_type: 'supplier',
            asset_id: supplier.id,
            asset_name: supplier.name,
            distance_or_match_basis: `Supplies HS chapter ${chapter} affected by event`,
          });
          break;
        }
      }
    }
  }

  return matches;
}

function evaluateRegulatoryPathway(
  category: string,
  countryIso: string | null | undefined,
  affectedDimensions: any,
  suppliers: any[],
  routes: any[]
): any[] {
  // Only relevant for regulatory categories
  if (!['Sanctions & Trade Policy', 'Regulatory & Compliance'].includes(category)) {
    return [];
  }

  const matches: any[] = [];

  // Check suppliers in affected country
  if (countryIso) {
    for (const supplier of suppliers) {
      if (supplier.country_iso?.toUpperCase() === countryIso.toUpperCase()) {
        matches.push({
          asset_type: 'supplier',
          asset_id: supplier.id,
          asset_name: supplier.name,
          distance_or_match_basis: `Supplier located in affected country: ${countryIso}`,
        });
      }
    }
  }

  // Check routes through affected country
  if (countryIso) {
    for (const route of routes) {
      // Simple check - could be enhanced with actual route country data
      if (route.origin?.includes(countryIso) || route.destination?.includes(countryIso)) {
        matches.push({
          asset_type: 'lane',
          asset_id: `${route.origin}-${route.destination}`,
          asset_name: `${route.origin} → ${route.destination}`,
          distance_or_match_basis: `Route involves affected country: ${countryIso}`,
        });
      }
    }
  }

  return matches;
}

function evaluateIndirectPathway(
  category: string,
  countryIso: string | null | undefined,
  eventIndustries: string[] | undefined,
  suppliers: any[]
): any[] {
  const matches: any[] = [];

  // Tier-N inference: suppliers in the same region/industry as the event
  // but not directly named or located in the affected area

  if (!countryIso && (!eventIndustries || eventIndustries.length === 0)) {
    return matches;
  }

  for (const supplier of suppliers) {
    let isInferredExposure = false;
    let reason = '';

    // Check country-level exposure (less precise than site-level)
    if (countryIso && supplier.country_iso?.toUpperCase() === countryIso.toUpperCase()) {
      // Only if we don't have precise coordinates (otherwise geographic_site would catch it)
      if (supplier.latitude === null || supplier.longitude === null) {
        isInferredExposure = true;
        reason = `Supplier in ${countryIso} (country-level match, no precise coordinates)`;
      }
    }

    // Check industry exposure
    if (eventIndustries && eventIndustries.length > 0) {
      // This would require industry classification of suppliers
      // For now, skip unless we have that data
    }

    if (isInferredExposure) {
      matches.push({
        asset_type: 'supplier',
        asset_id: supplier.id,
        asset_name: supplier.name,
        distance_or_match_basis: reason,
      });
    }
  }

  return matches;
}

function evaluateStrategicPathway(
  countryIso: string | null | undefined,
  affectedDimensions: any,
  strategicPriorities: any
): any[] {
  if (!strategicPriorities || !Array.isArray(strategicPriorities)) return [];

  const matches: any[] = [];

  for (const priority of strategicPriorities) {
    let isRelevant = false;
    let reason = '';

    // Check if event affects strategic initiative locations
    if (countryIso && priority.locations?.includes(countryIso)) {
      isRelevant = true;
      reason = `Event in ${countryIso} affects strategic initiative: ${priority.initiative}`;
    }

    // Check if event affects strategic partners
    if (affectedDimensions?.organizations) {
      for (const org of affectedDimensions.organizations) {
        if (priority.partners?.some((p: string) =>
          p.toLowerCase().includes(org.name?.toLowerCase() ?? '')
        )) {
          isRelevant = true;
          reason = `Event affects strategic partner: ${org.name}`;
          break;
        }
      }
    }

    if (isRelevant) {
      matches.push({
        asset_type: 'facility', // Using facility as generic asset type for strategic
        asset_id: `strategic-${priority.initiative?.replace(/\s+/g, '-').toLowerCase()}`,
        asset_name: priority.initiative,
        distance_or_match_basis: reason,
      });
    }
  }

  return matches;
}

type ExposureStrength = 'direct' | 'probable' | 'possible' | 'strategic' | 'none';
type ExposurePriority = 'critical' | 'high' | 'medium' | 'low';

function classifyExposure(
  pathwayMatches: any[],
  intrinsicSeverity: string
): { exposureStrength: ExposureStrength; exposurePriority: ExposurePriority; rationale: string } {
  const matchedPathways = pathwayMatches.filter((m) => m.matched);

  if (matchedPathways.length === 0) {
    return {
      exposureStrength: 'none',
      exposurePriority: 'low',
      rationale: 'No exposure pathways matched',
    };
  }

  // Check for direct matches (specific assets)
  const hasDirectMatch = matchedPathways.some((m) =>
    m.pathway === 'geographic_site' || m.pathway === 'entity'
  );

  // Check for probable matches
  const hasProbableMatch = matchedPathways.some((m) =>
    m.pathway === 'geographic_flow' || m.pathway === 'product' || m.pathway === 'regulatory'
  );

  // Check for strategic matches
  const hasStrategicMatch = matchedPathways.some((m) => m.pathway === 'strategic');

  // Check for indirect matches
  const hasIndirectMatch = matchedPathways.some((m) => m.pathway === 'indirect');

  let exposureStrength: ExposureStrength;
  if (hasDirectMatch) {
    exposureStrength = 'direct';
  } else if (hasProbableMatch) {
    exposureStrength = 'probable';
  } else if (hasStrategicMatch) {
    exposureStrength = 'strategic';
  } else if (hasIndirectMatch) {
    exposureStrength = 'possible';
  } else {
    exposureStrength = 'possible';
  }

  // Calculate priority based on severity and exposure strength
  const severityOrder = { low: 1, medium: 2, high: 3, critical: 4 };
  const strengthOrder = { possible: 1, strategic: 2, probable: 3, direct: 4 };
  const severityValue = severityOrder[intrinsicSeverity as keyof typeof severityOrder] ?? 1;
  const strengthValue = strengthOrder[exposureStrength as keyof typeof strengthOrder] ?? 1;

  let exposurePriority: ExposurePriority;
  const combinedScore = severityValue + strengthValue;
  if (combinedScore >= 7) {
    exposurePriority = 'critical';
  } else if (combinedScore >= 5) {
    exposurePriority = 'high';
  } else if (combinedScore >= 3) {
    exposurePriority = 'medium';
  } else {
    exposurePriority = 'low';
  }

  // Build rationale
  const matchedPathwayNames = matchedPathways.map((m) => m.pathway.replace(/_/g, ' '));
  const totalAssets = matchedPathways.reduce((sum, m) => sum + m.exposed_assets.length, 0);
  const rationale = `Exposure via ${matchedPathwayNames.join(', ')}. ${totalAssets} asset(s) potentially affected.`;

  return { exposureStrength, exposurePriority, rationale };
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
