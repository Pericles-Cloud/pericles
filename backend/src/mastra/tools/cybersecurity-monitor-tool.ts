import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Cybersecurity Monitor Tool
 *
 * Purpose: Track cybersecurity vulnerabilities, breaches, and threats affecting supply chain systems.
 *
 * Data Sources:
 * - NVD (National Vulnerability Database): CVE vulnerability data
 *   API: https://nvd.nist.gov/developers/vulnerabilities
 * - CISA Advisories: Critical infrastructure alerts (RSS)
 *   Feed: https://www.cisa.gov/cybersecurity-advisories/all.xml
 *
 * Risk Categories:
 * - Critical Vulnerabilities (CVEs)
 * - Data Breaches
 * - Ransomware Attacks
 * - Supply Chain Cyber Attacks
 * - Zero-Day Exploits
 *
 * Organization Isolation: Filters based on organization's technology stack
 */

const TechnologyInputSchema = z.object({
  vendor: z.string().optional(),
  product: z.string().optional(),
  version: z.string().optional(),
  cpe: z.string().optional().describe('Common Platform Enumeration identifier')
});

const CybersecurityEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(), // vulnerability, breach, ransomware, supply_chain_attack, zero_day
  title: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(1),
  cvss_score: z.number().min(0).max(10).optional().describe('CVSS v3 base score'),
  cve_id: z.string().optional().describe('CVE identifier (e.g., CVE-2024-1234)'),
  affected_vendors: z.array(z.string()).optional(),
  affected_products: z.array(z.string()).optional(),
  exploit_available: z.boolean().optional(),
  patch_available: z.boolean().optional(),
  published_at: z.string().datetime(),
  source: z.string(), // 'NVD' or 'CISA'
  source_url: z.string().url().optional(),
  raw_data: z.record(z.string(), z.any()).optional()
});

export const cybersecurityMonitorTool = createTool({
  id: 'cybersecurity-monitor',
  description: 'Monitor cybersecurity vulnerabilities (CVEs), data breaches, ransomware attacks, and supply chain cyber threats using NVD (National Vulnerability Database) and CISA advisories.',

  inputSchema: z.object({
    technologies: z.array(TechnologyInputSchema).optional().describe('Technology stack to monitor for vulnerabilities'),
    severity_threshold: z.enum(['low', 'medium', 'high', 'critical']).default('high').describe('Minimum CVSS severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (_required)')
  }),

  outputSchema: z.object({
    cybersecurity_events: z.array(CybersecurityEventSchema).describe('Detected cybersecurity threats'),
    vulnerabilities_found: z.number().int().describe('Number of CVEs found'),
    critical_count: z.number().int().describe('Number of critical severity events'),
    api_calls_made: z.number().int().describe('Number of API calls made to data sources')
  }),

  execute: async ({ context }) => {
    const { technologies: _technologies, severity_threshold: _severity_threshold, lookback_hours: _lookback_hours, organization_id } = context;

    // Log the input parameters received
    console.log(`[Cybersecurity Monitor] Tool executed with context:`, JSON.stringify(context, null, 2));

    // CRITICAL: Validate organization_id
    if (!organization_id) {
      throw new Error('organization_id is required for cybersecurity monitoring');
    }

    console.log(`[Cybersecurity Monitor] Monitoring for organization: ${organization_id}`);

    // PLACEHOLDER: Actual NVD and CISA API integration to be implemented
    // NVD API Docs: https://nvd.nist.gov/developers/vulnerabilities
    // CISA RSS Feed: https://www.cisa.gov/cybersecurity-advisories/all.xml

    try {
      const cybersecurityEvents: Array<z.infer<typeof CybersecurityEventSchema>> = [];
      const apiCallsMade = 0;
      const criticalCount = 0;

      // TODO: Implement NVD API integration
      // const nvdEvents = await fetchNVDVulnerabilities(_technologies, lookback_hours, severity_threshold);
      // apiCallsMade += 1;

      // TODO: Implement CISA RSS feed parsing
      // const cisaEvents = await fetchCISAAdvisories(lookback_hours);
      // apiCallsMade += 1;

      // PLACEHOLDER: Return empty array for now
      console.log(`[Cybersecurity Monitor] Found ${cybersecurityEvents.length} events (${criticalCount} critical), made ${apiCallsMade} API calls`);

      return {
        cybersecurity_events: cybersecurityEvents,
        vulnerabilities_found: cybersecurityEvents.length,
        critical_count: criticalCount,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      console.error(`[Cybersecurity Monitor] Failed to fetch cybersecurity data:`, error);
      throw new Error(`Cybersecurity monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// Helper Functions (to be implemented with actual API integration)
// ============================================================================

/**
 * Fetch vulnerabilities from NVD API 2.0
 * API Docs: https://nvd.nist.gov/developers/vulnerabilities
 *
 * Requires API Key (set in environment: NVD_API_KEY)
 */
async function _fetchNVDVulnerabilities(
  _technologies: Array<{ vendor?: string; product?: string; version?: string; cpe?: string }> | undefined,
  _lookbackHours: number,
  _severityThreshold: string
): Promise<Array<z.infer<typeof CybersecurityEventSchema>>> {
  // TODO: Implement NVD API calls
  //
  // const apiKey = process.env.NVD_API_KEY;
  // if (!apiKey) {
  //   console.warn('[Cybersecurity Monitor] NVD_API_KEY not set, skipping NVD check');
  //   return [];
  // }
  //
  // const events: z.infer<typeof CybersecurityEventSchema>[] = [];
  // const endDate = new Date();
  // const startDate = new Date(endDate.getTime() - lookbackHours * 60 * 60 * 1000);
  //
  // // NVD API 2.0 endpoint
  // const baseUrl = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
  //
  // if (technologies && technologies.length > 0) {
  //   // Search by specific CPEs or keywords
  //   for (const tech of technologies) {
  //     const url = new URL(_baseUrl);
  //     url.searchParams.set('pubStartDate', startDate.toISOString());
  //     url.searchParams.set('pubEndDate', endDate.toISOString());
  //
  //     if (tech.cpe) {
  //       url.searchParams.set('cpeName', tech.cpe);
  //     } else if (tech.product) {
  //       url.searchParams.set('keywordSearch', tech.product);
  //     }
  //
  //     const response = await fetch(url.toString(), {
  //       headers: { 'apiKey': apiKey }
  //     });
  //     const data = await response.json();
  //
  //     // Parse CVE data and map to CybersecurityEventSchema
  //     // Filter by CVSS score based on severity_threshold
  //   }
  // } else {
  //   // Get all recent CVEs above severity threshold
  //   const url = new URL(_baseUrl);
  //   url.searchParams.set('pubStartDate', startDate.toISOString());
  //   url.searchParams.set('pubEndDate', endDate.toISOString());
  //
  //   const response = await fetch(url.toString(), {
  //     headers: { 'apiKey': apiKey }
  //   });
  //   const data = await response.json();
  // }
  //
  // return events;

  return [];
}

/**
 * Fetch CISA cybersecurity advisories from RSS feed
 * Feed URL: https://www.cisa.gov/cybersecurity-advisories/all.xml
 */
async function _fetchCISAAdvisories(
  _lookbackHours: number
): Promise<Array<z.infer<typeof CybersecurityEventSchema>>> {
  // TODO: Implement CISA RSS feed parsing
  //
  // const feedUrl = 'https://www.cisa.gov/cybersecurity-advisories/all.xml';
  // const response = await fetch(_feedUrl);
  // const xmlText = await response.text();
  //
  // // Parse XML RSS feed
  // const parser = new DOMParser(); // or use xml2js library
  // const xml = parser.parseFromString(_xmlText, 'text/xml');
  //
  // const events: z.infer<typeof CybersecurityEventSchema>[] = [];
  // const items = xml.querySelectorAll('item');
  // const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  //
  // for (const item of items) {
  //   const pubDate = new Date(item.querySelector('pubDate')?.textContent || '');
  //   if (pubDate < cutoffDate) continue;
  //
  //   const title = item.querySelector('title')?.textContent || '';
  //   const description = item.querySelector('description')?.textContent || '';
  //   const link = item.querySelector('link')?.textContent || '';
  //
  //   // Extract CVE IDs from title/description
  //   // Classify event type (_vulnerability, breach, etc.)
  //   // Calculate severity
  //
  //   events.push({
  //     event_id: `cisa-${Date.now()}`,
  //     event_type: classifyEventType(_title, _description),
  //     title,
  //     description,
  //     severity: calculateSeverity(_title, _description),
  //     published_at: pubDate.toISOString(),
  //     source: 'CISA',
  //     source_url: link
  //   });
  // }
  //
  // return events;

  return [];
}

/**
 * Map CVSS score to normalized severity (0.0-1.0)
 *
 * CVSS v3 Scale:
 * - 0.0: None
 * - 0.1-3.9: Low
 * - 4.0-6.9: Medium
 * - 7.0-8.9: High
 * - 9.0-10.0: Critical
 */
function _cvssToSeverity(_cvssScore: number): number {
  return Math.max(0, Math.min(1, _cvssScore / 10));
}

/**
 * Check if CVSS score meets severity threshold
 */
function _meetsSeverityThreshold(_cvssScore: number, _threshold: string): boolean {
  switch (_threshold) {
    case 'critical':
      return _cvssScore >= 9.0;
    case 'high':
      return _cvssScore >= 7.0;
    case 'medium':
      return _cvssScore >= 4.0;
    case 'low':
      return _cvssScore >= 0.1;
    default:
      return true;
  }
}
