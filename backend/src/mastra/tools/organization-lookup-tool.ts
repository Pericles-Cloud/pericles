import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPrismaClient } from '../../monitoring/db-client';

const prisma = getPrismaClient();

/**
 * Organization Lookup Tool
 *
 * Purpose: Resolve company name, domain, or partial identifier to organization_id.
 *
 * This tool enables the agent to accept user-friendly identifiers like:
 * - Company name (exact or partial match)
 * - Email domain
 * - Organization ID (passthrough validation)
 *
 * Use Cases:
 * - User says "Monitor Levi Strauss" → Returns org_id for Levi Strauss
 * - User says "Check risks for acme.com" → Returns org_id for ACME Corp
 * - User provides UUID → Validates and returns the same UUID
 *
 * Organization Isolation: Returns only organizations the system has access to
 */

const OrganizationResultSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email_domain: z.string().nullable(),
  is_root: z.boolean(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  customer_type: z.string().nullable()
});

export const organizationLookupTool = createTool({
  id: 'organization-lookup',
  description: `Look up an organization by name, email domain, or ID. Use this tool FIRST when the user provides a company name instead of an organization ID. Returns the organization_id needed for all other monitoring tools.

Examples:
- "Levi Strauss" → Returns organization with matching name
- "levis.com" → Returns organization with matching email domain
- "abc-123-..." (UUID format) → Validates and returns the organization

ALWAYS use this tool when the user mentions a company by name before calling any monitoring tools.`,

  inputSchema: z.object({
    query: z.string().min(1).describe('Company name, email domain, or organization ID to look up'),
    match_type: z.enum(['auto', 'name', 'domain', 'id']).default('auto').describe('How to match the query: auto (detect), name (company name), domain (email domain), or id (UUID)')
  }),

  outputSchema: z.object({
    found: z.boolean().describe('Whether an organization was found'),
    organization: OrganizationResultSchema.nullable().describe('The matched organization, or null if not found'),
    alternatives: z.array(OrganizationResultSchema).describe('Other potential matches if multiple found'),
    match_type_used: z.string().describe('The matching strategy that was used'),
    message: z.string().describe('Human-readable result message')
  }),

  execute: async ({ context }) => {
    const { query, match_type } = context;
    const effectiveMatchTypeParam = match_type ?? 'auto';

    // Log the input parameters received
    console.log(`[Org Lookup] Tool executed with context:`, JSON.stringify(context, null, 2));

    if (!query || query.trim().length === 0) {
      return {
        found: false,
        organization: null,
        alternatives: [],
        match_type_used: 'none',
        message: 'Query is required. Please provide a company name, email domain, or organization ID.'
      };
    }

    const trimmedQuery = query.trim();
    console.log(`[Org Lookup] Searching for: "${trimmedQuery}" with match_type: ${effectiveMatchTypeParam}`);

    try {
      // Determine match type if auto
      let effectiveMatchType = effectiveMatchTypeParam;
      if (effectiveMatchTypeParam === 'auto') {
        // Check if it looks like a UUID
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidPattern.test(trimmedQuery)) {
          effectiveMatchType = 'id';
        }
        // Check if it looks like a domain (contains . and no spaces)
        else if (trimmedQuery.includes('.') && !trimmedQuery.includes(' ')) {
          effectiveMatchType = 'domain';
        }
        // Otherwise treat as name
        else {
          effectiveMatchType = 'name';
        }
      }

      console.log(`[Org Lookup] Using match type: ${effectiveMatchType}`);

      let organization = null;
      let alternatives: Array<z.infer<typeof OrganizationResultSchema>> = [];

      if (effectiveMatchType === 'id') {
        // Direct ID lookup
        organization = await prisma.organization.findUnique({
          where: { id: trimmedQuery },
          select: {
            id: true,
            name: true,
            email_domain: true,
            is_root: true,
            city: true,
            country: true,
            customer_type: true
          }
        });

      } else if (effectiveMatchType === 'domain') {
        // Domain lookup (exact match, case-insensitive)
        organization = await prisma.organization.findFirst({
          where: {
            email_domain: {
              equals: trimmedQuery.toLowerCase(),
              mode: 'insensitive'
            }
          },
          select: {
            id: true,
            name: true,
            email_domain: true,
            is_root: true,
            city: true,
            country: true,
            customer_type: true
          }
        });

      } else {
        // Name lookup - try exact match first, then partial
        organization = await prisma.organization.findFirst({
          where: {
            name: {
              equals: trimmedQuery,
              mode: 'insensitive'
            }
          },
          select: {
            id: true,
            name: true,
            email_domain: true,
            is_root: true,
            city: true,
            country: true,
            customer_type: true
          }
        });

        // If no exact match, try partial match (contains)
        if (!organization) {
          const partialMatches = await prisma.organization.findMany({
            where: {
              name: {
                contains: trimmedQuery,
                mode: 'insensitive'
              }
            },
            select: {
              id: true,
              name: true,
              email_domain: true,
              is_root: true,
              city: true,
              country: true,
              customer_type: true
            },
            take: 10, // Limit results
            orderBy: {
              name: 'asc'
            }
          });

          if (partialMatches.length === 1) {
            organization = partialMatches[0];
          } else if (partialMatches.length > 1) {
            // Return first as primary, rest as alternatives
            organization = partialMatches[0];
            alternatives = partialMatches.slice(1);
          }
        }
      }

      if (organization) {
        const message = alternatives.length > 0
          ? `Found "${organization.name}" (and ${alternatives.length} other potential matches)`
          : `Found organization: "${organization.name}"`;

        console.log(`[Org Lookup] ${message}`);

        return {
          found: true,
          organization,
          alternatives,
          match_type_used: effectiveMatchType,
          message
        };
      }

      // No match found
      console.log(`[Org Lookup] No organization found for query: "${trimmedQuery}"`);

      return {
        found: false,
        organization: null,
        alternatives: [],
        match_type_used: effectiveMatchType,
        message: `No organization found matching "${trimmedQuery}". Please verify the company name or provide an organization ID.`
      };

    } catch (error) {
      console.error(`[Org Lookup] Database query failed:`, error);
      throw new Error(`Failed to look up organization: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
});
