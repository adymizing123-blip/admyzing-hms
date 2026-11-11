import type { FieldDef } from '@/components/admin/ResourceManager';
import { SOURCE_OPTIONS } from '@/components/admin/ChannelBadge';

/** Shared form definitions so the same entity uses the same form everywhere. */
export const patientFields: FieldDef[] = [
  { name: 'first_name', label: 'First name', required: true },
  { name: 'last_name', label: 'Last name', required: true },
  { name: 'dob', label: 'Date of birth', type: 'date' },
  { name: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Street address', full: true },
  { name: 'city', label: 'City' },
  { name: 'state', label: 'State' },
  { name: 'zip', label: 'ZIP' },
  { name: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({ value: v, label: v })) },
  { name: 'allergies', label: 'Allergies' },
  { name: 'chronic_conditions', label: 'Chronic conditions' },
  { name: 'insurance_provider', label: 'Insurance provider' },
  { name: 'insurance_member_id', label: 'Insurance member ID' },
  { name: 'emergency_contact_name', label: 'Emergency contact' },
  { name: 'emergency_contact_phone', label: 'Emergency phone', type: 'tel' },
  { name: 'source', label: 'How they found us', type: 'select', options: SOURCE_OPTIONS },
  { name: 'source_detail', label: 'Ad / campaign / referred by' },
  { name: 'branch_id', label: 'Clinic (first visit)', type: 'select', optionsFrom: { table: 'branches', select: 'id, name', label: (r: any) => r.name, order: 'name' } },
  { name: 'marketing_opt_out', label: 'Opted out of marketing messages', type: 'checkbox' },
];

export const doctorOption = { table: 'doctors', select: 'id, full_name', label: (r: any) => r.full_name, order: 'full_name', filter: { active: true } };
export const patientOption = { table: 'patients', select: 'id, first_name, last_name, mrn', label: (r: any) => `${r.first_name} ${r.last_name} (${r.mrn})`, order: 'last_name' };
export const deptOption = { table: 'departments', select: 'id, name', label: (r: any) => r.name, order: 'name' };

export const roleOptions = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_tech', 'accountant', 'patient']
  .map((v) => ({ value: v, label: v.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }));

export const vaccineOption = { table: 'vaccines', select: 'id, name', label: (r: any) => r.name, order: 'name' };
