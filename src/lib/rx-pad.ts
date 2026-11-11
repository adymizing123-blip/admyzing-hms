export type PadDesign = 'classic' | 'modern' | 'side' | 'minimal';
export type PadPaper = 'A4' | 'A5';
export type PadFont = 'serif' | 'sans' | 'mono';

export type PadConfig = {
  design: PadDesign;
  color: string;
  paper: PadPaper;
  font: PadFont;
  qualifications: string;
  speciality: string;
  doctor_name: string;     // name printed on the pad; blank = the doctor's profile name
  reg_no: string;
  footer_note: string;
  logo: string;            // data URL, optional
  show_patient_line: boolean;
  show_vitals: boolean;
  show_rx_symbol: boolean;
  show_signature: boolean;
  watermark: boolean;
};

export const PAD_COLORS = ['#6b21a8', '#0e5a8a', '#047857', '#9f1239', '#1e293b', '#b45309'];

export const DEFAULT_PAD: PadConfig = {
  design: 'classic', color: PAD_COLORS[2], paper: 'A4', font: 'serif',
  qualifications: '', speciality: '', doctor_name: '', reg_no: '', footer_note: 'Please bring this prescription on your next visit.', logo: '',
  show_patient_line: true, show_vitals: true, show_rx_symbol: true, show_signature: true, watermark: false,
};

export const FONT_STACK: Record<PadFont, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};

/** page size in millimetres */
export const PAPER_MM: Record<PadPaper, { w: number; h: number }> = { A4: { w: 210, h: 297 }, A5: { w: 148, h: 210 } };
/** at 96 dpi, for the on-screen preview scale */
export const mmToPx = (mm: number) => (mm * 96) / 25.4;

export const mergePad = (saved?: Partial<PadConfig> | null): PadConfig => ({ ...DEFAULT_PAD, ...(saved || {}) });

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const t12 = (t?: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h >= 12 ? 'pm' : 'am'}`;
};

/** [1,2,3,4,5,6] -> "Mon-Sat", [1,3,5] -> "Mon, Wed, Fri" */
export function daysLabel(days?: number[] | null) {
  const d = [...new Set(days || [])].sort((a, b) => a - b);
  if (!d.length) return '';
  if (d.length === 7) return 'Every day';
  const consecutive = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (consecutive && d.length > 2) return `${DAY[d[0]]}-${DAY[d[d.length - 1]]}`;
  return d.map((x) => DAY[x]).join(', ');
}

export const timingsLabel = (c?: { days?: number[] | null; start_time?: string | null; end_time?: string | null } | null) =>
  c ? [daysLabel(c.days), c.start_time && c.end_time ? `${t12(c.start_time)} - ${t12(c.end_time)}` : ''].filter(Boolean).join(', ') : '';

export const DAY_NAMES = DAY;

/** clinic block printed on the pad: name, address, phone and timings of the clinic the patient came to */
export const clinicInfo = (b?: { name?: string | null; address?: string | null; phone?: string | null; timings?: string | null } | null) => ({
  name: b?.name || 'Clinic', address: b?.address || null, phone: b?.phone || null, timings: b?.timings || '',
});

/** The prescription as plain text, for WhatsApp / SMS / email. */
export function rxMessage(d: {
  doctorName: string; clinic: { name: string; address?: string | null; phone?: string | null };
  patient?: { name?: string; date?: string }; diagnosis?: string; advice?: string; followUp?: string; tests?: string[];
  items?: { medicine_name: string; dosage?: string; frequency?: string; duration?: string; instructions?: string }[];
}) {
  const L: string[] = [];
  L.push(`*${d.clinic.name}*`);
  const contact = [d.clinic.address, d.clinic.phone].filter(Boolean).join(' | ');
  if (contact) L.push(contact);
  L.push('', `Patient: ${d.patient?.name || '-'}${d.patient?.date ? `   Date: ${d.patient.date}` : ''}`, `Doctor: ${d.doctorName}`);
  if (d.diagnosis?.trim()) L.push(`Diagnosis: ${d.diagnosis.trim()}`);
  const items = (d.items || []).filter((i) => i.medicine_name?.trim());
  if (items.length) {
    L.push('', '*Medicines*');
    items.forEach((i, n) => {
      const det = [i.dosage, i.frequency, i.duration].filter(Boolean).join(', ');
      L.push(`${n + 1}. ${i.medicine_name}${det ? ` - ${det}` : ''}${i.instructions ? ` (${i.instructions})` : ''}`);
    });
  }
  if (d.tests?.length) L.push('', `Tests: ${d.tests.join(', ')}`);
  if (d.advice?.trim()) L.push('', `Advice: ${d.advice.trim()}`);
  if (d.followUp) L.push('', `Next visit: ${d.followUp}`);
  return L.join('\n');
}
