/**
 * Model + API-key resolution for the Global and Client Monitoring Agents
 * (issue #76). Neither agent has a static model: each call passes the model
 * resolved here through Mastra's runtimeContext, so there is never a platform
 * env key fallback (see #71 / MissingApiKeyError) and concurrent calls for
 * different orgs cannot share a key.
 *
 * - Client Monitoring: the tenant's own provider/model and key, resolved like
 *   the per-org monitoring cycle (resolveModel: credentials owner's secret).
 * - Global Monitoring: customer-agnostic, so billed to Pericles itself: the
 *   root organization's own `<provider>_api_key` in the Secrets Manager.
 */

import { RuntimeContext } from '@mastra/core/runtime-context';
import { getPrismaClient } from './db-client.js';
import { logger } from './logger.js';
import { loadMonitoringConfig, resolveModel, type ResolvedModel } from './config.js';

/**
 * The global loop has nobody to bill: there is not exactly one root org. Like
 * MissingApiKeyError, a configuration state the loop logs and skips (it must
 * not count as a failure and crash-restart the service).
 */
export class GlobalBillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlobalBillingConfigError';
  }
}

/** runtimeContext key both agents read their model from. */
export const MODEL_CONTEXT_KEY = 'model';

/** A runtimeContext carrying a resolved model, for agent.generate(..., { runtimeContext }). */
export function modelContext(model: ResolvedModel): RuntimeContext {
  const context = new RuntimeContext();
  context.set(MODEL_CONTEXT_KEY, model);
  return context;
}

/**
 * Returned when a caller passes no resolved model (e.g. the Mastra dev server,
 * which lists every agent's model inside one Promise.all, so throwing here
 * would break the whole agent list). It carries an explicit, invalid key: any
 * generation without a resolved model fails at the provider (401), and because
 * a key IS supplied, nothing falls back to the platform env key.
 */
export const UNRESOLVED_MODEL: ResolvedModel = {
  id: 'openai/gpt-4o-mini',
  apiKey: 'unresolved-model-pass-a-model-via-runtimeContext',
};

/**
 * The `model` an agent definition uses: the per-call resolved model, or
 * UNRESOLVED_MODEL (which cannot bill anyone) when a caller passed none.
 */
export function modelFromContext(agentName: string) {
  return ({ runtimeContext }: { runtimeContext: RuntimeContext }): ResolvedModel => {
    const model: ResolvedModel | undefined = runtimeContext.get(MODEL_CONTEXT_KEY);
    if (!model) {
      logger.warn(`${agentName}: no model in runtimeContext; using a non-billable placeholder (calls will fail)`);
      return UNRESOLVED_MODEL;
    }
    return model;
  };
}

/** The tenant's model + key for a Client Monitoring evaluation. Throws MissingApiKeyError if it has none. */
export async function resolveClientMonitoringModel(organizationId: string): Promise<ResolvedModel> {
  return resolveModel(await loadMonitoringConfig(organizationId));
}

/**
 * The Pericles root organization's model + key for the Global Monitoring loop.
 * Throws MissingApiKeyError if the root org has no key for its provider.
 */
export async function resolveGlobalMonitoringModel(): Promise<ResolvedModel> {
  const roots = await getPrismaClient().organization.findMany({
    where: { is_root: true },
    select: { id: true },
    take: 2,
  });
  if (roots.length !== 1) {
    throw new GlobalBillingConfigError(
      `Global Monitoring: expected exactly one root organization to bill the global loop to, found ${roots.length}`
    );
  }
  // Same resolution as every org (resolveModel): the credentials owner of the
  // root org is the root org itself, so this reads its own secret.
  return resolveModel(await loadMonitoringConfig(roots[0].id));
}
