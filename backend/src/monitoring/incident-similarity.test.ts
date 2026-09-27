/**
 * findDuplicateIncident + chooseDuplicateWinner (Vitest, per pericles-testing).
 *
 * Regression contract for "events must show once":
 * - The candidate query is NOT narrowed by `type` (the same article,
 *   classified differently — cyberattack vs vulnerability — must be
 *   comparable; type-narrowing let every cross-type duplicate through).
 * - Coordinate-less pairs are admitted only on a normalized-title match.
 * - Thresholds: 0.7 with geography, 0.9 without.
 * - The winner rule keeps the most accurate, then most recent, report.
 * - The per-call agent reads instructions via getInstructions() — the
 *   `.instructions` getter throws for array instructions and made every
 *   check fail open in prod (zero duplicates among ~1500 events).
 *
 * The Agent and its generate() are mocked; the DB is a one-method stub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findDuplicateIncident,
  chooseDuplicateWinner,
  normalizedTitleKey,
} from './incident-similarity.js';

const { generateMock, getInstructionsMock, agentConfigs, AgentMock } = vi.hoisted(() => {
  const generateMock = vi.fn();
  const getInstructionsMock = vi.fn(() => ['line one', 'line two']);
  const agentConfigs: Array<Record<string, unknown>> = [];
  class AgentMock {
    generate = generateMock;
    getInstructions = getInstructionsMock;
    constructor(config: Record<string, unknown>) {
      agentConfigs.push(config);
    }
  }
  return { generateMock, getInstructionsMock, agentConfigs, AgentMock };
});

vi.mock('@mastra/core/agent', () => ({ Agent: AgentMock }));

const ORG = '644adb63-6e64-42d2-85d9-98a7c5691672';

type Client = Parameters<typeof findDuplicateIncident>[0];

function clientReturning(rows: Array<Record<string, unknown>>) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { client: { event: { findMany } } as unknown as Client, findMany };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    type: 'cyberattack',
    title: 'CVE-2026-100614 Capgo cross-tenant integrity vulnerability',
    description: 'A crafted plugin payload allows cross-tenant token reuse.',
    event_timestamp: new Date('2026-09-26T12:00:00Z'),
    confidence: 0.8,
    location: { latitude: 10, longitude: 10 },
    ...overrides,
  };
}

/** In-area candidate: ~70km from the input's (10,10) for the geo tests. */
function geoCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-geo',
    title: 'Capgo plug-in flaw exposes tenant tokens, researchers say',
    description: 'Researchers demonstrated cross-tenant token reuse in Capgo.',
    latitude: 10.5,
    longitude: 10.5,
    event_timestamp: new Date('2026-09-26T11:00:00Z'),
    confidence: 0.7,
    raw_data: { original: true },
    ...overrides,
  };
}

beforeEach(() => {
  generateMock.mockReset();
  getInstructionsMock.mockClear();
  agentConfigs.length = 0;
});

describe('findDuplicateIncident — candidate query', () => {
  it('is NOT narrowed by type; scopes by org, time window and status', async () => {
    const { client, findMany } = clientReturning([]);
    await findDuplicateIncident(client, ORG, input(), { remaining: 10 });

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.organization_id).toBe(ORG);
    expect(where).not.toHaveProperty('type');
    expect(where.event_timestamp).toHaveProperty('gte');
    expect(where.event_timestamp).toHaveProperty('lte');
    expect(where.validation_status).toEqual({ notIn: ['duplicate', 'rejected'] });
  });

  it('reads instructions via getInstructions() (never the throwing getter)', async () => {
    const { client } = clientReturning([]);
    await findDuplicateIncident(client, ORG, input(), { remaining: 10 });
    expect(getInstructionsMock).toHaveBeenCalledTimes(1);
    expect(agentConfigs[0]?.instructions).toEqual(['line one', 'line two']);
  });

  it('calls generate once per admitted candidate with both reports', async () => {
    generateMock.mockResolvedValue({ object: { same_incident: false, confidence: 0.2, reason: 'differ' } });
    const { client } = clientReturning([geoCandidate()]);
    await findDuplicateIncident(client, ORG, input(), { remaining: 10 });
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(String(generateMock.mock.calls[0][0])).toContain('Report A');
    expect(String(generateMock.mock.calls[0][0])).toContain('Report B');
  });
});

describe('findDuplicateIncident — verdicts', () => {
  it('matches a geo candidate at 0.7 (threshold inclusive) and carries winner inputs', async () => {
    generateMock.mockResolvedValue({ object: { same_incident: true, confidence: 0.7, reason: 'same CVE' } });
    const { client } = clientReturning([geoCandidate()]);
    const match = await findDuplicateIncident(client, ORG, input(), { remaining: 10 });
    expect(match).not.toBeNull();
    expect(match?.id).toBe('cand-geo');
    expect(match?.event_timestamp).toEqual(new Date('2026-09-26T11:00:00Z'));
    expect(match?.existingConfidence).toBe(0.7);
  });

  it('rejects a geo candidate below 0.7', async () => {
    generateMock.mockResolvedValue({ object: { same_incident: true, confidence: 0.65, reason: 'nearby only' } });
    const { client } = clientReturning([geoCandidate()]);
    expect(await findDuplicateIncident(client, ORG, input(), { remaining: 10 })).toBeNull();
  });

  it('rejects same_incident:false regardless of confidence', async () => {
    generateMock.mockResolvedValue({ object: { same_incident: false, confidence: 0.99, reason: 'different' } });
    const { client } = clientReturning([geoCandidate()]);
    expect(await findDuplicateIncident(client, ORG, input(), { remaining: 10 })).toBeNull();
  });

  it('no-geo + title match: 0.95 passes, 0.85 fails (the stricter bar)', async () => {
    const noGeo = geoCandidate({ latitude: null, longitude: null });
    // Same normalized headline as input(), different punctuation/case.
    noGeo.title = 'CVE-2026-100614: Capgo cross-tenant integrity vulnerability!';

    generateMock.mockResolvedValue({ object: { same_incident: true, confidence: 0.95, reason: 'same CVE id' } });
    const { client } = clientReturning([noGeo]);
    expect(await findDuplicateIncident(client, ORG, input(), { remaining: 10 })).not.toBeNull();

    generateMock.mockResolvedValue({ object: { same_incident: true, confidence: 0.85, reason: 'same CVE id' } });
    expect(await findDuplicateIncident(client, ORG, input(), { remaining: 10 })).toBeNull();
  });

  it('no-geo + different title: never reaches the model', async () => {
    const unrelated = geoCandidate({ latitude: null, longitude: null, title: 'Unrelated headline entirely' });
    const { client } = clientReturning([unrelated]);
    expect(await findDuplicateIncident(client, ORG, input(), { remaining: 10 })).toBeNull();
    expect(generateMock).not.toHaveBeenCalled();
  });
});

describe('findDuplicateIncident — budget', () => {
  it('exhausted budget short-circuits before the candidate query', async () => {
    const { client, findMany } = clientReturning([geoCandidate()]);
    expect(await findDuplicateIncident(client, ORG, input(), { remaining: 0 })).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('caps classifier calls at the remaining budget and decrements it', async () => {
    generateMock.mockResolvedValue({ object: { same_incident: false, confidence: 0.1, reason: 'no' } });
    const rows = [
      geoCandidate({ id: 'a' }),
      geoCandidate({ id: 'b', latitude: 10.6, longitude: 10.6 }),
    ];
    const { client } = clientReturning(rows);
    const budget = { remaining: 1 };
    await findDuplicateIncident(client, ORG, input(), budget);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(budget.remaining).toBe(0);
  });
});

describe('chooseDuplicateWinner — the ticket rule: most accurate, then most recent', () => {
  const at = (iso: string) => new Date(iso);

  it('keeps the more accurate report even if it is older', () => {
    expect(
      chooseDuplicateWinner(
        { event_timestamp: at('2026-09-20T00:00:00Z'), confidence: 0.9 },
        { event_timestamp: at('2026-09-26T00:00:00Z'), confidence: 0.7 }
      )
    ).toBe('incoming');
  });

  it('with equal accuracy, keeps the more recent report', () => {
    expect(
      chooseDuplicateWinner(
        { event_timestamp: at('2026-09-27T00:00:00Z'), confidence: 0.8 },
        { event_timestamp: at('2026-09-26T00:00:00Z'), confidence: 0.8 }
      )
    ).toBe('incoming');
    expect(
      chooseDuplicateWinner(
        { event_timestamp: at('2026-09-25T00:00:00Z'), confidence: 0.8 },
        { event_timestamp: at('2026-09-26T00:00:00Z'), confidence: 0.8 }
      )
    ).toBe('existing');
  });

  it('full tie keeps the existing (first-seen) row — re-ingestion cannot flip the primary', () => {
    expect(
      chooseDuplicateWinner(
        { event_timestamp: at('2026-09-26T00:00:00Z'), confidence: 0.8 },
        { event_timestamp: at('2026-09-26T00:00:00Z'), confidence: 0.8 }
      )
    ).toBe('existing');
  });

  it('missing confidence counts as 0, not as best', () => {
    expect(
      chooseDuplicateWinner(
        { event_timestamp: at('2026-09-26T00:00:00Z'), confidence: null },
        { event_timestamp: at('2026-09-01T00:00:00Z'), confidence: 0.5 }
      )
    ).toBe('existing');
    expect(
      chooseDuplicateWinner(
        { event_timestamp: at('2026-09-26T00:00:00Z'), confidence: 0.5 },
        { event_timestamp: at('2026-09-01T00:00:00Z'), confidence: null }
      )
    ).toBe('incoming');
  });
});

describe('normalizedTitleKey', () => {
  it('collides case/punctuation/spacing differences of the same headline', () => {
    expect(normalizedTitleKey('US-National Guard deployed to port!')).toBe(
      normalizedTitleKey('us national guard deployed to port')
    );
  });

  it('caps at 40 normalized characters and separates different headlines', () => {
    expect(normalizedTitleKey('a'.repeat(100))).toHaveLength(40);
    expect(normalizedTitleKey('Port strike in Hamburg')).not.toBe(normalizedTitleKey('Flood warning for Rotterdam'));
  });
});
