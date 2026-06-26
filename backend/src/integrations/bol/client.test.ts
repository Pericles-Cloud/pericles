/**
 * BOL trial adapter — client/normalizeRecord tests (Vitest, per pericles-testing).
 *
 * Fixtures are real rows from the ImportYeti row-level actor
 * (jungle_synthesizer/importyeti-bill-of-lading-scraper), captured via the
 * tools/atlas_bol_validate.py DEBUG dump. Guards the field mapping against
 * silent drift back to the old (wrong) aliases.
 */
import { describe, it, expect } from 'vitest';
import { normalizeRecord } from './client.js';

const billOfLadingRow = {
  record_type: 'bill_of_lading',
  target_type: 'company',
  target_slug: 'sun-hydraulics',
  target_name: 'Sun Hydraulics',
  target_address: '1500 W University Pkwy, Sarasota, Fl 34243, Us',
  arrival_date: '06/20/2026',
  bill_of_lading: 'EXDO6396041129',
  master_bill_of_lading: 'COSU6451557470',
  carrier_code: 'COSU',
  counterparty_name: 'Suzhou Yilian Industrial & Tech Lt',
  counterparty_city: 'Jishi',
  counterparty_country: 'China',
  weight_kg: 3173,
  quantity: 386,
  container_count: 1,
  hs_codes: ['3923.50.90', '8481.90.90'],
};

const summaryRow = {
  record_type: 'summary',
  target_slug: 'sun-hydraulics',
  target_name: 'Sun Hydraulics',
  bill_of_lading: '',
  counterparty_name: '',
  top_counterparties: ['Suzhou Yilian Industrial & Tech Lt | China | 37'],
};

describe('normalizeRecord (ImportYeti actor schema)', () => {
  it('maps a per-shipment row to the BolRow shape', () => {
    const row = normalizeRecord(billOfLadingRow);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      bol_number: 'EXDO6396041129',
      shipment_date: '06/20/2026',
      supplier_name: 'Suzhou Yilian Industrial & Tech Lt',
      supplier_city: 'Jishi',
      supplier_country: 'China',
      consignee_name: 'Sun Hydraulics',
      destination_country: 'US',
      carrier_scac: 'COSU',
      weight_kg: 3173,
      quantity: 386,
      containers: 1,
      hs_codes: ['3923.50.90', '8481.90.90'],
    });
  });

  it('derives US city/state from target_address', () => {
    const row = normalizeRecord(billOfLadingRow);
    expect(row?.destination_city).toBe('Sarasota');
    expect(row?.destination_state).toBe('FL');
  });

  it('skips the aggregate summary row', () => {
    expect(normalizeRecord(summaryRow)).toBeNull();
  });

  it('returns null when the BOL number or supplier is missing', () => {
    expect(normalizeRecord({ counterparty_name: 'X' })).toBeNull(); // no bol
    expect(normalizeRecord({ bill_of_lading: 'B1' })).toBeNull(); // no supplier
  });
});
