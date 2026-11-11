'use client';
import { useRouter } from 'next/navigation';
import ResourceManager from '@/components/admin/ResourceManager';
import { StatusBadge } from '@/components/ui';
import { doctorOption, patientOption } from '@/lib/fields';
import { fmtDateTime } from '@/lib/utils';

export default function OT() {
  const router = useRouter();
  return (
    <ResourceManager
      table="ot_schedules" branchScoped
      title="Operation Theatre"
      subtitle="Schedule surgeries, then open one to record anesthesia, operative notes, consumables and billing."
      onRowClick={(r) => router.push(`/admin/ot/${r.id}`)}
      select="*, patients(first_name, last_name, mrn), doctors!ot_schedules_doctor_id_fkey(full_name)"
      orderBy={{ column: 'scheduled_at', ascending: true }}
      columns={[
        { key: 'scheduled_at', label: 'When', render: (r) => fmtDateTime(r.scheduled_at) },
        { key: 'procedure_name', label: 'Procedure', render: (r) => <span className="font-semibold">{r.procedure_name}</span> },
        { key: 'patient', label: 'Patient', render: (r) => `${r.patients?.first_name} ${r.patients?.last_name}` },
        { key: 'doctor', label: 'Surgeon', render: (r) => r.doctors?.full_name || '-', hideOnMobile: true },
        { key: 'theatre', label: 'Theatre' },
        { key: 'duration_minutes', label: 'Duration', render: (r) => `${r.duration_minutes} min`, hideOnMobile: true },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      searchColumns={['procedure_name', 'theatre']}
      fields={[
        { name: 'patient_id', label: 'Patient', type: 'select', optionsFrom: patientOption, required: true },
        { name: 'doctor_id', label: 'Surgeon', type: 'select', optionsFrom: doctorOption },
        { name: 'procedure_name', label: 'Procedure', required: true },
        { name: 'theatre', label: 'Theatre', type: 'select', options: ['OT-1', 'OT-2', 'OT-3', 'Cath Lab'].map((v) => ({ value: v, label: v })), required: true },
        { name: 'scheduled_at', label: 'Date & time', type: 'datetime', required: true },
        { name: 'duration_minutes', label: 'Duration (min)', type: 'number' },
        { name: 'anesthetist_id', label: 'Anesthetist', type: 'select', optionsFrom: doctorOption },
        { name: 'procedure_fee', label: 'Procedure fee ($)', type: 'number' },
        { name: 'procedure_code', label: 'CPT code' },
        { name: 'status', label: 'Status', type: 'select', options: ['scheduled', 'in_progress', 'completed', 'cancelled'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      defaults={{ theatre: 'OT-1', duration_minutes: 60, status: 'scheduled' }}
    />
  );
}
