import { describe, it, expect } from 'vitest';
import { toE164, fill } from '@/lib/messaging';
import { buildClaim, claimProblems } from '@/lib/claims';
import { parseHL7, parseResultsCSV, mapFlag, hl7Ack } from '@/lib/hl7';
import { money, age, fullName, titleCase } from '@/lib/utils';
import { t, translations } from '@/lib/i18n';

describe('phone numbers', () => {
  it('formats US numbers to E.164', () => {
    expect(toE164('(512) 555-0141')).toBe('+15125550141');
    expect(toE164('1-512-555-0141')).toBe('+15125550141');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('555-01')).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe('message templates', () => {
  it('fills placeholders and blanks unknown ones', () => {
    expect(fill('Hi {first_name}, see you {date}{x}', { first_name: 'Ana', date: 'Mon' })).toBe('Hi Ana, see you Mon');
  });
});

describe('formatting', () => {
  it('formats USD', () => expect(money(1234.5)).toBe('$1,234.50'));
  it('handles missing values', () => { expect(money(null)).toBe('$0.00'); expect(age(null)).toBe('-'); expect(fullName(null)).toBe('-'); });
  it('title-cases snake case', () => expect(titleCase('in_consultation')).toBe('In Consultation'));
});

describe('insurance claims', () => {
  const claim = {
    id: 'c1', provider: 'Aetna', payer_id: '60054', member_id: 'M1', diagnosis_codes: 'e78.5, R50.9', amount: 220, created_at: '2026-11-09',
    invoices: { invoice_no: 'INV-1', created_at: '2026-11-09T10:00:00Z',
      patients: { first_name: 'John', last_name: 'Doe', dob: '1978-04-12', gender: 'male', address: '1 Main', city: 'Austin', state: 'TX', zip: '78701' },
      invoice_items: [{ description: 'CBC', code: '85025', quantity: 1, line_total: 45, category: 'lab' }, { description: 'Credit', code: null, quantity: 1, line_total: -5, category: 'other' }] },
  };
  it('builds a claim payload', () => {
    const c = buildClaim(claim, { name: 'H', npi: '1234567893', tax_id: '74-1', address: 'x', phone: 'y' });
    expect(c.diagnosis_codes).toEqual(['E78.5', 'R50.9']);
    expect(c.service_lines).toHaveLength(1);
    expect(c.subscriber.gender).toBe('M');
    expect(claimProblems(c)).toEqual([]);
  });
  it('lists missing claim data', () => {
    const c = buildClaim({ ...claim, payer_id: null, diagnosis_codes: '' }, { name: 'H' });
    const p = claimProblems(c);
    expect(p.join(' ')).toMatch(/NPI/);
    expect(p.join(' ')).toMatch(/Payer ID/);
    expect(p.join(' ')).toMatch(/ICD-10/);
  });
});

describe('HL7 lab results', () => {
  const msg = [
    'MSH|^~\\&|ANALYZER|LAB|CAREPLUS|HOSP|20261109101500||ORU^R01|MSG0001|P|2.5',
    'PID|1||MRN100001^^^CAREPLUS||Anderson^John||19780412|M',
    'OBR|1|LAB-2001||CBC^Complete Blood Count',
    'OBX|1|NM|CBC^Complete Blood Count||7.2|10^3/uL|4.0-11.0|N|||F',
    'OBR|2|LAB-2001||LIPID^Lipid Panel',
    'OBX|1|NM|LIPID^Lipid Panel||245|mg/dL|<200|H|||F',
  ].join('\r');
  it('parses patient, orders and results', () => {
    const m = parseHL7(msg);
    expect(m.mrn).toBe('MRN100001');
    expect(m.controlId).toBe('MSG0001');
    expect(m.orders).toHaveLength(2);
    expect(m.orders[1].results[0]).toMatchObject({ code: 'LIPID', value: '245', units: 'mg/dL', flag: 'high' });
  });
  it('maps abnormal flags', () => {
    expect(mapFlag('HH')).toBe('critical'); expect(mapFlag('L')).toBe('low'); expect(mapFlag('N')).toBe('normal'); expect(mapFlag('')).toBeNull();
  });
  it('rejects non-HL7 text', () => expect(() => parseHL7('hello')).toThrow());
  it('parses the CSV format', () => {
    const m = parseResultsCSV('order_no,test_code,result,flag\nLAB-2001,CBC,7.1,N\nLAB-2001,TSH,9.9,H');
    expect(m.orders[0].results).toHaveLength(2);
    expect(m.orders[0].results[1].flag).toBe('high');
  });
  it('builds an ACK', () => expect(hl7Ack('MSG0001', true)).toContain('MSA|AA|MSG0001'));
});

describe('translations', () => {
  it('has a Spanish entry for every English key', () => {
    const missing = Object.keys(translations).filter((k) => !translations[k]);
    expect(missing).toEqual([]);
  });
  it('falls back to English', () => {
    expect(t('es', 'Book Appointment')).toBe('Reservar cita');
    expect(t('en', 'Book Appointment')).toBe('Book Appointment');
    expect(t('es', 'Some new text')).toBe('Some new text');
  });
});
