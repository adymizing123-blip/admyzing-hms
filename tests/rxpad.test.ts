import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RxPadSheet, type PadData } from '@/components/admin/RxPad';
import { mergePad, rxMessage, clinicInfo, type PadDesign } from '@/lib/rx-pad';
import { toE164, whatsappLink } from '@/lib/phone';

const data: PadData = {
  doctorName: 'Dr. Salman',
  clinic: clinicInfo({ name: 'Glow Clinic Gulgasht', address: 'Shop 4, Main Boulevard', phone: '0300 1234567', timings: 'Mon-Sat, 5pm - 9pm' }),
  patient: { name: 'Ali Khan', mrn: 'MRN1', age: '34', sex: 'male', date: 'Nov 10, 2026' },
  vitals: { bp: '120/80' }, complaints: 'Fever', diagnosis: 'Viral infection',
  items: [{ medicine_name: 'Paracetamol 500mg', dosage: '1 tab', frequency: 'Twice daily', duration: '3 days', instructions: 'After food' }],
  tests: ['CBC'], advice: 'Rest', followUp: 'Nov 17, 2026',
};

describe('prescription pad', () => {
  (['classic', 'modern', 'side', 'minimal'] as PadDesign[]).forEach((design) => {
    it(`renders ${design} with patient, doctor, clinic and medicine`, () => {
      const html = renderToStaticMarkup(createElement(RxPadSheet, { cfg: mergePad({ design }), data }));
      for (const t of ['Ali Khan', 'Dr. Salman', 'Glow Clinic Gulgasht', 'Shop 4, Main Boulevard', 'Paracetamol 500mg', 'Viral infection', 'CBC']) expect(html).toContain(t);
    });
  });
  it('A5 is narrower than A4', () => {
    expect(renderToStaticMarkup(createElement(RxPadSheet, { cfg: mergePad({ paper: 'A5' }), data }))).toContain('width:148mm');
  });
  it('builds the WhatsApp text', () => {
    const m = rxMessage(data);
    expect(m).toContain('Glow Clinic Gulgasht');
    expect(m).toContain('1. Paracetamol 500mg - 1 tab, Twice daily, 3 days (After food)');
  });
  it('formats Pakistani and US numbers for WhatsApp', () => {
    expect(toE164('0300 1234567')).toBe('+923001234567');
    expect(toE164('(512) 555-0141')).toBe('+15125550141');
    expect(whatsappLink('0300 1234567', 'Hi there')).toBe('https://wa.me/923001234567?text=Hi%20there');
  });
});
