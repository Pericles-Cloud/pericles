import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { limitEvents, getFilterSummary } from './output-limiter.js';
import { toolLoggers } from './tool-logger.js';

const logger = toolLoggers.cybersecurity;

/**
 * Cybersecurity Monitor Tool
 *
 * Purpose: Track cybersecurity vulnerabilities, breaches, and threats affecting supply chain systems.
 *
 * Data Sources:
 * - NVD (National Vulnerability Database): CVE vulnerability data
 *   API: https://nvd.nist.gov/developers
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
  vendor: z.string().nullable().optional(),
  product: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  cpe: z.string().nullable().optional().describe('Common Platform Enumeration identifier')
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
    technologies: z.array(TechnologyInputSchema).nullable().optional().describe('Technology stack to monitor for vulnerabilities. Pass null or omit to monitor general threats.'),
    severity_threshold: z.enum(['low', 'medium', 'high', 'critical']).default('high').describe('Minimum CVSS severity to report'),
    lookback_hours: z.number().int().min(1).max(168).default(24).describe('How many hours back to check for events'),
    organization_id: z.string().uuid().describe('Organization identifier (required)')
  }),

  outputSchema: z.object({
    cybersecurity_events: z.array(CybersecurityEventSchema).describe('Detected cybersecurity threats'),
    vulnerabilities_found: z.number().int().describe('Number of CVEs found'),
    critical_count: z.number().int().describe('Number of critical severity events'),
    api_calls_made: z.number().int().describe('Number of API calls made to data sources')
  }),

  execute: async ({ context }) => {
    const { technologies, severity_threshold, lookback_hours, organization_id } = context;

    logger.debug({ context }, 'Tool executed');

    if (!organization_id) {
      throw new Error('organization_id is required for cybersecurity monitoring');
    }

    logger.info({ organization_id }, 'Monitoring for organization');

    try {
      const cybersecurityEvents: Array<z.infer<typeof CybersecurityEventSchema>> = [];
      let apiCallsMade = 0;

      // Fetch NVD vulnerabilities
      const { events: nvdEvents, apiCalls: nvdCalls } = await fetchNVDVulnerabilities(
        technologies ?? undefined,
        lookback_hours,
        severity_threshold
      );
      apiCallsMade += nvdCalls;
      cybersecurityEvents.push(...nvdEvents);

      // Fetch CISA advisories
      const { events: cisaEvents, apiCalls: cisaCalls } = await fetchCISAAdvisories(
        lookback_hours,
        severity_threshold
      );
      apiCallsMade += cisaCalls;
      cybersecurityEvents.push(...cisaEvents);

      const criticalCount = cybersecurityEvents.filter(e => e.severity >= 0.9).length;
      const vulnerabilitiesFound = cybersecurityEvents.filter(e => e.cve_id).length;

      // Limit output to prevent context overflow
      const MAX_EVENTS = 10;
      const limitedEvents = limitEvents(cybersecurityEvents, MAX_EVENTS);
      logger.info({ totalEvents: cybersecurityEvents.length, limitedEvents: limitedEvents.length }, getFilterSummary(cybersecurityEvents.length, limitedEvents.length, 'Cybersecurity Monitor'));

      return {
        cybersecurity_events: limitedEvents,
        vulnerabilities_found: vulnerabilitiesFound,
        critical_count: criticalCount,
        api_calls_made: apiCallsMade
      };

    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch cybersecurity data');
      throw new Error(`Cybersecurity monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});

// ============================================================================
// NVD API 2.0 Integration
// ============================================================================

interface NVDCVEItem {
  id: string;
  sourceIdentifier: string;
  published: string;
  lastModified: string;
  vulnStatus: string;
  descriptions: Array<{ lang: string; value: string }>;
  metrics?: {
    cvssMetricV31?: Array<{
      cvssData: {
        baseScore: number;
        baseSeverity: string;
        attackVector: string;
        exploitabilityScore: number;
        impactScore: number;
      };
      exploitabilityScore: number;
      impactScore: number;
    }>;
    cvssMetricV30?: Array<{
      cvssData: {
        baseScore: number;
        baseSeverity: string;
      };
    }>;
  };
  configurations?: Array<{
    nodes: Array<{
      cpeMatch: Array<{
        vulnerable: boolean;
        criteria: string;
        matchCriteriaId: string;
      }>;
    }>;
  }>;
  references?: Array<{
    url: string;
    source: string;
    tags?: string[];
  }>;
}

interface NVDResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  vulnerabilities: Array<{ cve: NVDCVEItem }>;
}

/**
 * Fetch vulnerabilities from NVD API 2.0
 * API Docs: https://nvd.nist.gov/developers
 */
async function fetchNVDVulnerabilities(
  technologies: Array<{ vendor?: string | null; product?: string | null; version?: string | null; cpe?: string | null }> | undefined,
  lookbackHours: number,
  severityThreshold: string
): Promise<{ events: Array<z.infer<typeof CybersecurityEventSchema>>; apiCalls: number }> {
  const events: Array<z.infer<typeof CybersecurityEventSchema>> = [];
  let apiCalls = 0;

  const apiKey = process.env.NVD_API_KEY;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackHours * 60 * 60 * 1000);

  // Format dates for NVD API (ISO 8601 format)
  const pubStartDate = startDate.toISOString();
  const pubEndDate = endDate.toISOString();

  const baseUrl = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

  try {
    if (technologies && technologies.length > 0) {
      // Search by specific CPEs or keywords
      for (const tech of technologies) {
        const url = new URL(baseUrl);
        url.searchParams.set('pubStartDate', pubStartDate);
        url.searchParams.set('pubEndDate', pubEndDate);

        if (tech.cpe) {
          url.searchParams.set('cpeName', tech.cpe);
        } else if (tech.product) {
          url.searchParams.set('keywordSearch', tech.product);
          url.searchParams.set('keywordExactMatch', '');
        } else if (tech.vendor) {
          url.searchParams.set('keywordSearch', tech.vendor);
        } else {
          continue; // Skip if no search criteria
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (apiKey) {
          headers.apiKey = apiKey;
        }

        const response = await fetch(url.toString(), {
          headers,
          signal: AbortSignal.timeout(30000)
        });

        apiCalls++;

        if (!response.ok) {
          logger.warn({ status: response.status, tech: tech.product || tech.vendor }, 'API error for technology');
          continue;
        }

        const data = await response.json() as NVDResponse;
        const parsedEvents = parseNVDResponse(data, severityThreshold);
        events.push(...parsedEvents);

        // Rate limiting: NVD allows 5 requests/30s without API key, 50 requests/30s with key
        await sleep(apiKey ? 600 : 6000);
      }
    } else {
      // Get all recent CVEs above severity threshold
      const url = new URL(baseUrl);
      url.searchParams.set('pubStartDate', pubStartDate);
      url.searchParams.set('pubEndDate', pubEndDate);

      // Filter by CVSS severity
      const cvssFilter = getCVSSFilter(severityThreshold);
      if (cvssFilter) {
        url.searchParams.set('cvssV3Severity', cvssFilter);
      }

      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (apiKey) {
        headers.apiKey = apiKey;
      }

      const response = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(30000)
      });

      apiCalls++;

      if (response.ok) {
        const data = await response.json() as NVDResponse;
        const parsedEvents = parseNVDResponse(data, severityThreshold);
        events.push(...parsedEvents);
        logger.info({ totalCVEs: data.totalResults, matchedCVEs: parsedEvents.length }, 'Fetched CVEs from NVD');
      } else {
        logger.warn({ status: response.status }, 'NVD API error');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error fetching vulnerabilities from NVD');
  }

  return { events, apiCalls };
}

function parseNVDResponse(
  data: NVDResponse,
  severityThreshold: string
): Array<z.infer<typeof CybersecurityEventSchema>> {
  const events: Array<z.infer<typeof CybersecurityEventSchema>> = [];

  if (!data.vulnerabilities || !Array.isArray(data.vulnerabilities)) {
    return events;
  }

  for (const vuln of data.vulnerabilities) {
    const cve = vuln.cve;

    // Get CVSS score (prefer v3.1, fall back to v3.0)
    let cvssScore: number | undefined;
    let baseSeverity: string | undefined;

    if (cve.metrics?.cvssMetricV31?.[0]) {
      cvssScore = cve.metrics.cvssMetricV31[0].cvssData.baseScore;
      baseSeverity = cve.metrics.cvssMetricV31[0].cvssData.baseSeverity;
    } else if (cve.metrics?.cvssMetricV30?.[0]) {
      cvssScore = cve.metrics.cvssMetricV30[0].cvssData.baseScore;
      baseSeverity = cve.metrics.cvssMetricV30[0].cvssData.baseSeverity;
    }

    // Check severity threshold
    if (cvssScore !== undefined && !meetsSeverityThreshold(cvssScore, severityThreshold)) {
      continue;
    }

    // Get English description
    const description = cve.descriptions.find(d => d.lang === 'en')?.value || cve.descriptions[0]?.value || '';

    // Extract affected vendors/products from CPE
    const affectedVendors = new Set<string>();
    const affectedProducts = new Set<string>();

    if (cve.configurations) {
      for (const config of cve.configurations) {
        for (const node of config.nodes) {
          for (const match of node.cpeMatch) {
            if (match.vulnerable) {
              // CPE format: cpe:2.3:a:vendor:product:version:...
              const cpeParts = match.criteria.split(':');
              if (cpeParts.length >= 5) {
                affectedVendors.add(cpeParts[3]);
                affectedProducts.add(cpeParts[4]);
              }
            }
          }
        }
      }
    }

    // Check if exploit or patch available from references
    let exploitAvailable = false;
    let patchAvailable = false;

    if (cve.references) {
      for (const ref of cve.references) {
        if (ref.tags?.includes('Exploit')) exploitAvailable = true;
        if (ref.tags?.includes('Patch')) patchAvailable = true;
      }
    }

    // Classify event type
    const eventType = classifyCyberEventType(cve.id, description, baseSeverity, exploitAvailable);

    events.push({
      event_id: `nvd-${cve.id}`,
      event_type: eventType,
      title: `${cve.id}: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`,
      description: description.substring(0, 1000),
      severity: cvssToSeverity(cvssScore),
      cvss_score: cvssScore,
      cve_id: cve.id,
      affected_vendors: affectedVendors.size > 0 ? Array.from(affectedVendors) : undefined,
      affected_products: affectedProducts.size > 0 ? Array.from(affectedProducts) : undefined,
      exploit_available: exploitAvailable,
      patch_available: patchAvailable,
      published_at: new Date(cve.published).toISOString(),
      source: 'NVD',
      source_url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      raw_data: { vulnStatus: cve.vulnStatus, lastModified: cve.lastModified }
    });
  }

  return events;
}

function getCVSSFilter(threshold: string): string | null {
  switch (threshold) {
    case 'critical': return 'CRITICAL';
    case 'high': return 'HIGH';
    case 'medium': return 'MEDIUM';
    case 'low': return 'LOW';
    default: return null;
  }
}

// ============================================================================
// CISA RSS Feed Integration
// ============================================================================

/**
 * Fetch CISA cybersecurity advisories from RSS feed
 * Feed URL: https://www.cisa.gov/cybersecurity-advisories/all.xml
 */
async function fetchCISAAdvisories(
  lookbackHours: number,
  severityThreshold: string
): Promise<{ events: Array<z.infer<typeof CybersecurityEventSchema>>; apiCalls: number }> {
  const events: Array<z.infer<typeof CybersecurityEventSchema>> = [];
  let apiCalls = 0;

  const feedUrl = 'https://www.cisa.gov/cybersecurity-advisories/all.xml';
  const cutoffDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  try {
    const response = await fetch(feedUrl, {
      headers: { 'Accept': 'application/xml, text/xml, application/rss+xml' },
      signal: AbortSignal.timeout(15000)
    });

    apiCalls++;

    if (!response.ok) {
      logger.warn({ status: response.status }, 'CISA RSS feed error');
      return { events, apiCalls };
    }

    const xmlText = await response.text();

    // Parse RSS XML manually (no DOM parser in Node.js)
    const items = parseRSSItems(xmlText);

    logger.info({ itemCount: items.length }, 'Parsed items from CISA RSS feed');

    for (const item of items) {
      const pubDate = new Date(item.pubDate);
      if (pubDate < cutoffDate) continue;

      // Extract CVE IDs from title/description
      const cveIds = extractCVEIds(`${item.title  } ${  item.description}`);

      // Classify event type and calculate severity
      const eventType = classifyCISAEventType(item.title, item.description);
      const severity = calculateCISASeverity(item.title, item.description, eventType);

      // Check severity threshold
      const cvssEquivalent = severity * 10;
      if (!meetsSeverityThreshold(cvssEquivalent, severityThreshold)) {
        continue;
      }

      events.push({
        event_id: `cisa-${hashString(item.link || item.title)}`,
        event_type: eventType,
        title: item.title,
        description: item.description.substring(0, 1000),
        severity,
        cve_id: cveIds.length > 0 ? cveIds[0] : undefined,
        published_at: pubDate.toISOString(),
        source: 'CISA',
        source_url: item.link,
        raw_data: { cve_ids: cveIds.length > 1 ? cveIds : undefined }
      });
    }

    logger.info({ advisoryCount: events.length }, 'CISA advisories within lookback period');

  } catch (err) {
    logger.error({ err }, 'Error fetching CISA advisories');
  }

  return { events, apiCalls };
}

interface RSSItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

function parseRSSItems(xmlText: string): RSSItem[] {
  const items: RSSItem[] = [];

  // Simple regex-based XML parsing for RSS items
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];

    const title = extractXMLTag(itemContent, 'title');
    const description = extractXMLTag(itemContent, 'description');
    const link = extractXMLTag(itemContent, 'link');
    const pubDate = extractXMLTag(itemContent, 'pubDate');

    if (title && pubDate) {
      items.push({
        title: decodeHTMLEntities(title),
        description: decodeHTMLEntities(description || ''),
        link: link || '',
        pubDate
      });
    }
  }

  return items;
}

function extractXMLTag(content: string, tag: string): string | null {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = content.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular tags
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ''); // Strip HTML tags
}

function extractCVEIds(text: string): string[] {
  const cveRegex = /CVE-\d{4}-\d{4,}/gi;
  const matches = text.match(cveRegex);
  return matches ? Array.from(new Set(matches.map(m => m.toUpperCase()))) : [];
}

function classifyCISAEventType(title: string, description: string): string {
  const text = (`${title  } ${  description}`).toLowerCase();

  if (text.includes('ransomware')) return 'ransomware';
  if (text.includes('supply chain')) return 'supply_chain_attack';
  if (text.includes('zero-day') || text.includes('zero day') || text.includes('0-day')) return 'zero_day';
  if (text.includes('breach') || text.includes('data leak')) return 'breach';
  if (text.includes('critical') || text.includes('vulnerability') || text.includes('cve')) return 'vulnerability';

  return 'security_advisory';
}

function calculateCISASeverity(title: string, description: string, eventType: string): number {
  let baseSeverity = 0.6;

  // Adjust based on event type
  switch (eventType) {
    case 'zero_day': baseSeverity = 0.95; break;
    case 'ransomware': baseSeverity = 0.9; break;
    case 'supply_chain_attack': baseSeverity = 0.85; break;
    case 'breach': baseSeverity = 0.8; break;
    case 'vulnerability': baseSeverity = 0.7; break;
  }

  const text = (`${title  } ${  description}`).toLowerCase();

  // Increase for critical keywords
  if (text.includes('critical')) baseSeverity = Math.min(0.95, baseSeverity + 0.1);
  if (text.includes('actively exploited')) baseSeverity = Math.min(0.99, baseSeverity + 0.1);
  if (text.includes('emergency') || text.includes('urgent')) baseSeverity = Math.min(0.95, baseSeverity + 0.05);

  return baseSeverity;
}

// ============================================================================
// Shared Utility Functions
// ============================================================================

function classifyCyberEventType(
  cveId: string,
  description: string,
  baseSeverity?: string,
  exploitAvailable?: boolean
): string {
  const descLower = description.toLowerCase();

  if (exploitAvailable && baseSeverity === 'CRITICAL') return 'zero_day';
  if (descLower.includes('ransomware')) return 'ransomware';
  if (descLower.includes('supply chain')) return 'supply_chain_attack';
  if (descLower.includes('remote code execution') || descLower.includes('rce')) return 'vulnerability';
  if (descLower.includes('privilege escalation')) return 'vulnerability';
  if (descLower.includes('data breach') || descLower.includes('data leak')) return 'breach';

  return 'vulnerability';
}

/**
 * Map CVSS score to normalized severity (0.0-1.0)
 */
function cvssToSeverity(cvssScore: number | undefined): number {
  if (cvssScore === undefined) return 0.5;
  return Math.max(0, Math.min(1, cvssScore / 10));
}

/**
 * Check if CVSS score meets severity threshold
 */
function meetsSeverityThreshold(cvssScore: number, threshold: string): boolean {
  switch (threshold) {
    case 'critical': return cvssScore >= 9.0;
    case 'high': return cvssScore >= 7.0;
    case 'medium': return cvssScore >= 4.0;
    case 'low': return cvssScore >= 0.1;
    default: return true;
  }
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substring(0, 12);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
