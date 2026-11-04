/**
 * Organizational Memory Service
 *
 * Provides storage and retrieval of strategic documents for each organization.
 * Documents are stored in KeyValueStore with embeddings for semantic search.
 *
 * Document types:
 * - Annual planning documents
 * - Strategic initiatives
 * - Risk appetite statements
 * - Key account commitments
 * - Past event responses
 *
 * Integration points:
 * - ClientExposureProfile sync (strategic_priorities, key_account_commitments, stated_concerns)
 * - Client Monitoring Agent (strategic pathway evaluation)
 */

import { getPrismaClient } from './db-client.js';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface OrgMemoryDocument {
  id: string;
  organization_id: string;
  title: string;
  content: string;
  document_type: DocumentType;
  metadata: DocumentMetadata;
  created_at: Date;
  updated_at: Date;
}

export type DocumentType =
  | 'annual_plan'
  | 'strategic_initiative'
  | 'risk_appetite'
  | 'key_account'
  | 'past_event'
  | 'policy'
  | 'other';

export interface DocumentMetadata {
  tags?: string[];
  effective_date?: string;
  expiration_date?: string;
  locations?: string[]; // Country codes or region names
  partners?: string[]; // Named partners/suppliers
  initiatives?: string[]; // Named initiatives
  source?: string; // Where this document came from
}

export interface StrategicPriority {
  initiative: string;
  description: string;
  target_date?: string;
  locations: string[];
  partners: string[];
  document_refs: string[];
}

export interface KeyAccountCommitment {
  account: string;
  sla?: string;
  dependent_supply: string[];
  document_refs: string[];
}

export interface StatedConcern {
  concern: string;
  risk_appetite?: string;
  document_refs: string[];
}

// ============================================================================
// Document Storage
// ============================================================================

const NAMESPACE = 'org_memory';

/**
 * Store a document in Organizational Memory
 */
export async function storeDocument(
  organizationId: string,
  doc: Omit<OrgMemoryDocument, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
): Promise<string> {
  const prisma = getPrismaClient();
  const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const document: OrgMemoryDocument = {
    id: docId,
    organization_id: organizationId,
    ...doc,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Store in KeyValueStore
  await prisma.keyValueStore.upsert({
    where: {
      organization_id_namespace_key: {
        organization_id: organizationId,
        namespace: NAMESPACE,
        key: docId,
      },
    },
    create: {
      organization_id: organizationId,
      namespace: NAMESPACE,
      key: docId,
      value: document as any,
    },
    update: {
      value: document as any,
      updated_at: new Date(),
    },
  });

  logger.info(
    { organizationId, docId, title: doc.title, type: doc.document_type },
    '[OrgMemory] Document stored'
  );

  return docId;
}

/**
 * Retrieve a document by ID
 */
export async function getDocument(
  organizationId: string,
  docId: string
): Promise<OrgMemoryDocument | null> {
  const prisma = getPrismaClient();

  const record = await prisma.keyValueStore.findUnique({
    where: {
      organization_id_namespace_key: {
        organization_id: organizationId,
        namespace: NAMESPACE,
        key: docId,
      },
    },
  });

  if (!record) return null;
  return record.value as unknown as OrgMemoryDocument;
}

/**
 * List all documents for an organization
 */
export async function listDocuments(
  organizationId: string,
  documentType?: DocumentType
): Promise<OrgMemoryDocument[]> {
  const prisma = getPrismaClient();

  const where: any = {
    organization_id: organizationId,
    namespace: NAMESPACE,
  };

  const records = await prisma.keyValueStore.findMany({
    where,
    orderBy: { updated_at: 'desc' },
  });

  let documents = records.map((r) => r.value as unknown as OrgMemoryDocument);

  if (documentType) {
    documents = documents.filter((d) => d.document_type === documentType);
  }

  return documents;
}

/**
 * Delete a document
 */
export async function deleteDocument(
  organizationId: string,
  docId: string
): Promise<boolean> {
  const prisma = getPrismaClient();

  const result = await prisma.keyValueStore.deleteMany({
    where: {
      organization_id: organizationId,
      namespace: NAMESPACE,
      key: docId,
    },
  });

  return result.count > 0;
}

// ============================================================================
// Semantic Search (Simple keyword-based for now)
// ============================================================================

/**
 * Search documents by keywords
 * TODO: Implement vector-based semantic search with pgvector
 */
export async function searchDocuments(
  organizationId: string,
  query: string,
  options: {
    documentType?: DocumentType;
    limit?: number;
  } = {}
): Promise<Array<OrgMemoryDocument & { relevance_score: number }>> {
  const documents = await listDocuments(organizationId, options.documentType);
  const limit = options.limit ?? 10;

  // Simple keyword matching (TODO: replace with vector search)
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  const scored = documents.map((doc) => {
    const content = `${doc.title} ${doc.content}`.toLowerCase();
    const tags = (doc.metadata.tags ?? []).join(' ').toLowerCase();
    const fullText = `${content} ${tags}`;

    let score = 0;
    for (const term of queryTerms) {
      if (fullText.includes(term)) {
        score += 1;
        // Bonus for exact phrase match
        if (content.includes(term)) score += 0.5;
      }
    }

    // Normalize by query length
    score = score / queryTerms.length;

    return { ...doc, relevance_score: score };
  });

  // Sort by relevance and return top N
  return scored
    .filter((d) => d.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);
}

// ============================================================================
// Structured Data Extraction
// ============================================================================

/**
 * Extract strategic priorities from documents
 */
export async function getStrategicPriorities(
  organizationId: string
): Promise<StrategicPriority[]> {
  const docs = await listDocuments(organizationId, 'strategic_initiative');

  const priorities: StrategicPriority[] = [];

  for (const doc of docs) {
    // Extract structured data from metadata
    const priority: StrategicPriority = {
      initiative: doc.title,
      description: doc.content.substring(0, 500), // First 500 chars as description
      target_date: doc.metadata.effective_date,
      locations: doc.metadata.locations ?? [],
      partners: doc.metadata.partners ?? [],
      document_refs: [doc.id],
    };

    priorities.push(priority);
  }

  // Also check annual plans for initiatives
  const annualPlans = await listDocuments(organizationId, 'annual_plan');
  for (const plan of annualPlans) {
    const initiatives = plan.metadata.initiatives ?? [];
    for (const initiative of initiatives) {
      priorities.push({
        initiative: initiative as string,
        description: `From annual plan: ${plan.title}`,
        target_date: plan.metadata.effective_date,
        locations: plan.metadata.locations ?? [],
        partners: plan.metadata.partners ?? [],
        document_refs: [plan.id],
      });
    }
  }

  return priorities;
}

/**
 * Extract key account commitments from documents
 */
export async function getKeyAccountCommitments(
  organizationId: string
): Promise<KeyAccountCommitment[]> {
  const docs = await listDocuments(organizationId, 'key_account');

  return docs.map((doc) => ({
    account: doc.title,
    sla: doc.metadata.tags?.find((t) => t.startsWith('sla:'))?.substring(4),
    dependent_supply: doc.metadata.partners ?? [],
    document_refs: [doc.id],
  }));
}

/**
 * Extract stated concerns from documents
 */
export async function getStatedConcerns(
  organizationId: string
): Promise<StatedConcern[]> {
  const docs = await listDocuments(organizationId, 'risk_appetite');

  return docs.map((doc) => ({
    concern: doc.title,
    risk_appetite: doc.content.substring(0, 200),
    document_refs: [doc.id],
  }));
}

// ============================================================================
// Profile Sync Integration
// ============================================================================

/**
 * Sync Organizational Memory data to ClientExposureProfile
 */
export async function syncToClientExposureProfile(
  organizationId: string
): Promise<{
  strategicPriorities: StrategicPriority[];
  keyAccountCommitments: KeyAccountCommitment[];
  statedConcerns: StatedConcern[];
}> {
  const prisma = getPrismaClient();

  const [strategicPriorities, keyAccountCommitments, statedConcerns] = await Promise.all([
    getStrategicPriorities(organizationId),
    getKeyAccountCommitments(organizationId),
    getStatedConcerns(organizationId),
  ]);

  // Update ClientExposureProfile
  await prisma.clientExposureProfile.update({
    where: { organization_id: organizationId },
    data: {
      strategic_priorities: strategicPriorities as any,
      key_account_commitments: keyAccountCommitments as any,
      stated_concerns: statedConcerns as any,
      last_org_memory_sync: new Date(),
      updated_at: new Date(),
    },
  });

  logger.info(
    {
      organizationId,
      strategicPriorities: strategicPriorities.length,
      keyAccountCommitments: keyAccountCommitments.length,
      statedConcerns: statedConcerns.length,
    },
    '[OrgMemory] Synced to ClientExposureProfile'
  );

  return { strategicPriorities, keyAccountCommitments, statedConcerns };
}

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Get all Org Memory data for an organization (for API responses)
 */
export async function getOrgMemorySummary(organizationId: string): Promise<{
  document_count: number;
  documents_by_type: Record<DocumentType, number>;
  strategic_priorities: StrategicPriority[];
  key_account_commitments: KeyAccountCommitment[];
  stated_concerns: StatedConcern[];
  last_sync: Date | null;
}> {
  const prisma = getPrismaClient();
  const documents = await listDocuments(organizationId);

  const documentsByType = documents.reduce((acc, doc) => {
    acc[doc.document_type] = (acc[doc.document_type] ?? 0) + 1;
    return acc;
  }, {} as Record<DocumentType, number>);

  const profile = await prisma.clientExposureProfile.findUnique({
    where: { organization_id: organizationId },
    select: { last_org_memory_sync: true },
  });

  const [strategicPriorities, keyAccountCommitments, statedConcerns] = await Promise.all([
    getStrategicPriorities(organizationId),
    getKeyAccountCommitments(organizationId),
    getStatedConcerns(organizationId),
  ]);

  return {
    document_count: documents.length,
    documents_by_type: documentsByType,
    strategic_priorities: strategicPriorities,
    key_account_commitments: keyAccountCommitments,
    stated_concerns: statedConcerns,
    last_sync: profile?.last_org_memory_sync ?? null,
  };
}
