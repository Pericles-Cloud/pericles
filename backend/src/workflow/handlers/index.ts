/**
 * Node Handler Registry
 *
 * Exports all node handlers and provides a registry for handler lookup.
 */

import type { NodeType } from '@prisma/client';
import type { NodeHandler } from '../types.js';
import { TriggerHandler } from './trigger-handler.js';
import { ActionHandler } from './action-handler.js';
import { ConditionHandler } from './condition-handler.js';
import { NotificationHandler } from './notification-handler.js';
import { EndHandler } from './end-handler.js';

// Export individual handlers
export { BaseNodeHandler } from './base-handler.js';
export { TriggerHandler } from './trigger-handler.js';
export { ActionHandler } from './action-handler.js';
export { ConditionHandler } from './condition-handler.js';
export { NotificationHandler } from './notification-handler.js';
export { EndHandler } from './end-handler.js';

/**
 * Registry of all available node handlers
 */
const handlers: NodeHandler[] = [
  new TriggerHandler(),
  new ActionHandler(),
  new ConditionHandler(),
  new NotificationHandler(),
  new EndHandler(),
];

/**
 * Get the appropriate handler for a node type
 *
 * @param nodeType - The type of node to get a handler for
 * @returns The handler for the node type, or undefined if not found
 */
export function getHandler(nodeType: NodeType): NodeHandler | undefined {
  return handlers.find((handler) => handler.canHandle(nodeType));
}

/**
 * Get all registered handlers
 *
 * @returns Array of all registered handlers
 */
export function getAllHandlers(): NodeHandler[] {
  return [...handlers];
}

/**
 * Check if a handler exists for a node type
 *
 * @param nodeType - The node type to check
 * @returns True if a handler exists for the node type
 */
export function hasHandler(nodeType: NodeType): boolean {
  return handlers.some((handler) => handler.canHandle(nodeType));
}
