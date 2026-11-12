'use client';
import { useRouter } from 'next/navigation';
import ResourceManager from '@/components/admin/ResourceManager';
import { patientFields } from '@/lib/fields';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SourceBadge, SOURCE_OPTIONS } from '@/components/admin/ChannelBadge';
import { age, fmtDate } from '@/lib/utils';
import { useBranch } from '@/components/admin/branch';

export default function Patients() {
  const router = useRouter();
  const [source, setSource] = useState('');
  const { branchId } = useBranch();
  const [clinic, setClinic] = useState(branchId || '');
  const [clinics, setClinics] = useState<any[]>([]);
  useEffect(() => { createClient().from('branches').select('id, name').eq('active', true).order('name').then(({ data }) => setClinics(data || [])); }, []);
  return (
    <ResourceManager
      table="patients"
      title="Patients"
      subtitle="Register patients and open their full medical record."
      select="*, branches(name)"
      filters={{ source, branch_id: clinic }}
      headerActions={
        <>
          <select className="input w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
            <option value="">All sources</option>{SOURCE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input w-auto" value={clinic} onChange={(e) => setClinic(e.target.value)} aria-label="Clinic">
            <option value="">All clinics</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      }
      columns={[
        { key: 'name', label: 'Patient', render: (r) => <div><p className="font-semibold">{r.first_name} {r.last_name}</p><p className="text-xs text-ink-muted">{r.mrn}</p></div> },
        { key: 'age', label: 'Age / Sex', render: (r) => `${age(r.dob)} ${r.gender ? '· ' + r.gender[0].toUpperCase() : ''}` },
        { key: 'phone', label: 'Phone' },
        { key: 'source', label: 'Source', render: (r) => <div className="max-w-[200px]"><SourceBadge source={r.source} detail={r.source_detail} /></div>, hideOnMobile: true },
        { key: 'clinic', label: 'Clinic', render: (r) => r.branches?.name || '-', hideOnMobile: true },
        { key: 'created_at', label: 'Registered', render: (r) => fmtDate(r.created_at), hideOnMobile: true },
      ]}
      fields={patientFields}
      searchColumns={['first_name', 'last_name', 'mrn', 'phone', 'email']}
      onRowClick={(r) => router.push(`/admin/patients/${r.id}`)}
      canDelete={false}
    />
  );
}
