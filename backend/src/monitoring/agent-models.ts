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
import {
  loadMonitoringConfig,
  resolveAiApiKey,
  resolveModel,
  MissingApiKeyError,
  type ResolvedModel,
} from './config.js';

/** runtimeContext key both agents read their model from. */
export const MODEL_CONTEXT_KEY = 'model';

/** A runtimeContext carrying a resolved model, for agent.generate(..., { runtimeContext }). */
export function modelContext(model: ResolvedModel): RuntimeContext {
  const context = new RuntimeContext();
  context.set(MODEL_CONTEXT_KEY, model);
  return context;
}

/**
 * The `model` an agent definition uses: read the per-call resolved model.
 * Throws when none was passed, so a call can never fall back to a default
 * model billed to the platform env key.
 */
export function modelFromContext(agentName: string) {
  return ({ runtimeContext }: { runtimeContext: RuntimeContext }): ResolvedModel => {
    const model: ResolvedModel | undefined = runtimeContext.get(MODEL_CONTEXT_KEY);
    if (!model) {
      throw new Error(`${agentName}: no model in runtimeContext; resolve one with agent-models.ts (no platform key fallback)`);
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
  const root = await getPrismaClient().organization.findFirst({ where: { is_root: true }, select: { id: true } });
  if (!root) {
    throw new Error('Global Monitoring: no root organization found to bill the global loop to');
  }
  const config = await loadMonitoringConfig(root.id);
  const { provider, modelName } = config.ai;
  // The root org's OWN secret: no credentials-owner climb (it has no parent).
  const apiKey = await resolveAiApiKey(root.id, provider);
  if (!apiKey) {
    throw new MissingApiKeyError(root.id, provider);
  }
  const id: `${string}/${string}` = provider === 'openrouter' ? `openrouter/${modelName}` : `${provider}/${modelName}`;
  return { id, apiKey };
}
