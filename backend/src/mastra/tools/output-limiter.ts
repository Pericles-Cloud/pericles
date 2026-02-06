/**
 * Output Limiter Utility
 *
 * Helps prevent context window overflow by limiting the size of tool outputs.
 * - Limits number of events returned
 * - Truncates raw_data to essential fields
 * - Sorts by severity (highest first)
 */

const MAX_EVENTS_DEFAULT = 10;
const MAX_RAW_DATA_KEYS = 5;
const MAX_STRING_LENGTH = 500;

interface EventWithSeverity {
  severity?: number;
  raw_data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Truncate a value to reduce size
 */
function truncateValue(value: unknown, maxLength: number = MAX_STRING_LENGTH): unknown {
  if (typeof value === 'string' && value.length > maxLength) {
    return `${value.slice(0, maxLength)}...`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map(v => truncateValue(v, maxLength));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_RAW_DATA_KEYS) {
      const truncated = Object.fromEntries(entries.slice(0, MAX_RAW_DATA_KEYS));
      return { ...truncated, _truncated: true };
    }
    return Object.fromEntries(
      entries.map(([k, v]) => [k, truncateValue(v, maxLength)])
    );
  }
  return value;
}

/**
 * Truncate raw_data to reduce output size
 */
function truncateRawData(rawData: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!rawData) return undefined;

  const entries = Object.entries(rawData);
  if (entries.length <= MAX_RAW_DATA_KEYS) {
    return truncateValue(rawData) as Record<string, unknown>;
  }

  // Keep only essential keys
  const essentialKeys = ['id', 'type', 'source', 'url', 'timestamp', 'date'];
  const kept: Record<string, unknown> = {};

  for (const key of essentialKeys) {
    if (rawData[key] !== undefined) {
      kept[key] = truncateValue(rawData[key]);
    }
  }

  // Fill remaining slots with other keys
  let count = Object.keys(kept).length;
  for (const [key, value] of entries) {
    if (count >= MAX_RAW_DATA_KEYS) break;
    if (!essentialKeys.includes(key)) {
      kept[key] = truncateValue(value);
      count++;
    }
  }

  return { ...kept, _truncated: true };
}

/**
 * Limit and sort events by severity
 *
 * @param events Array of events with optional severity field
 * @param maxEvents Maximum number of events to return (default 10)
 * @returns Sorted and limited events with truncated raw_data
 */
export function limitEvents<T extends EventWithSeverity>(
  events: T[],
  maxEvents: number = MAX_EVENTS_DEFAULT
): T[] {
  // Sort by severity (highest first)
  const sorted = [...events].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));

  // Limit count
  const limited = sorted.slice(0, maxEvents);

  // Truncate raw_data in each event
  return limited.map(event => ({
    ...event,
    raw_data: truncateRawData(event.raw_data)
  }));
}

/**
 * Get a summary of filtered events for logging
 */
export function getFilterSummary(
  totalEvents: number,
  returnedEvents: number,
  toolName: string
): string {
  if (totalEvents > returnedEvents) {
    return `[${toolName}] Returning top ${returnedEvents} of ${totalEvents} events (sorted by severity)`;
  }
  return `[${toolName}] Returning all ${totalEvents} events`;
}
