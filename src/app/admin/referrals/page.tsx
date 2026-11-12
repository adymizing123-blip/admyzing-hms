'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import NewAppointment from '@/components/admin/NewAppointment';
import { PageHeader, Tabs, Badge, StatusBadge } from '@/components/ui';
import { doctorOption, patientOption } from '@/lib/fields';
import { fmtDate, titleCase } from '@/lib/utils';

function Referrals() {
  const supabase = createClient();
  const params = useSearchParams();
  const [tab, setTab] = useState('all');
  const [myDoctor, setMyDoctor] = useState<string | null>(null);
  const [book, setBook] = useState<any>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      const { data } = await supabase.from('doctors').select('id').eq('profile_id', user?.id).maybeSingle();
      if (data) { setMyDoctor(data.id); setTab('incoming'); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = async (id: string, patch: any) => { await supabase.from('referrals').update(patch).eq('id', id); setReload((x) => x + 1); };

  const filters = tab === 'incoming' ? { to_doctor_id: myDoctor } : tab === 'outgoing' ? { from_doctor_id: myDoctor } : tab === 'pending' ? { status: 'pending' } : {};

  return (
    <div>
      <PageHeader title="Referrals" subtitle="Refer patients between your doctors or to outside specialists, then book the visit." />
      <Tabs value={tab} onChange={setTab} tabs={[...(myDoctor ? [{ id: 'incoming', label: 'Referred to me' }, { id: 'outgoing', label: 'My referrals' }] : []), { id: 'pending', label: 'Pending' }, { id: 'all', label: 'All' }]} />
      <ResourceManager embedded table="referrals" branchVia="patients" title="Referrals" filters={filters} reloadKey={reload}
        select="*, patients(id, first_name, last_name, mrn), from:doctors!referrals_from_doctor_id_fkey(full_name), to:doctors!referrals_to_doctor_id_fkey(full_name)"
        columns={[
          { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
          { key: 'patient', label: 'Patient', render: (r) => <div><p className="font-semibold">{r.patients?.first_name} {r.patients?.last_name}</p><p className="text-xs text-ink-muted">{r.patients?.mrn}</p></div> },
          { key: 'route', label: 'From → To', render: (r) => <span className="text-xs">{r.from?.full_name || '-'} → <b>{r.to?.full_name || r.external_to || '-'}</b></span> },
          { key: 'reason', label: 'Reason', className: 'whitespace-normal max-w-xs', hideOnMobile: true },
          { key: 'urgency', label: 'Urgency', render: (r) => <Badge tone={r.urgency === 'urgent' ? 'red' : 'gray'}>{titleCase(r.urgency)}</Badge> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status === 'declined' ? 'denied' : r.status === 'accepted' ? 'approved' : r.status} /> },
        ]}
        rowActions={(r) => (
          <>
            {r.status === 'pending' && r.to_doctor_id && <button className="btn-primary btn-sm" onClick={() => update(r.id, { status: 'accepted' })}>Accept</button>}
            {r.status === 'pending' && <button className="btn-ghost btn-sm text-rose-600" onClick={() => { const why = prompt('Reason for declining'); if (why) update(r.id, { status: 'declined', response: why }); }}>Decline</button>}
            {['pending', 'accepted'].includes(r.status) && r.to_doctor_id && <button className="btn-secondary btn-sm" onClick={() => setBook(r)}>Book visit</button>}
            {r.status === 'scheduled' && <button className="btn-secondary btn-sm" onClick={() => update(r.id, { status: 'completed' })}>Complete</button>}
          </>
        )}
        fields={[
          { name: 'patient_id', label: 'Patient', type: 'select', required: true, optionsFrom: patientOption },
          { name: 'from_doctor_id', label: 'Referring doctor', type: 'select', optionsFrom: doctorOption },
          { name: 'to_doctor_id', label: 'Refer to (our doctor)', type: 'select', optionsFrom: doctorOption },
          { name: 'external_to', label: 'Or outside specialist / facility' },
          { name: 'urgency', label: 'Urgency', type: 'select', options: [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }] },
          { name: 'reason', label: 'Reason & clinical summary', type: 'textarea', required: true },
          { name: 'response', label: 'Response / notes', type: 'textarea' },
        ]}
        defaults={{ urgency: 'routine', status: 'pending', from_doctor_id: myDoctor, patient_id: params.get('new') || undefined }}
      />
      <NewAppointment open={!!book} onClose={() => setBook(null)} presetPatientId={book?.patients?.id}
        onSaved={async () => {
          const { data } = await supabase.from('appointments').select('id').eq('patient_id', book.patients.id).order('created_at', { ascending: false }).limit(1).single();
          await update(book.id, { status: 'scheduled', appointment_id: data?.id });
        }} />
    </div>
  );
}

export default function Page() { return <Suspense><Referrals /></Suspense>; }
