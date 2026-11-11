'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { PageHeader, Tabs, Badge, Empty } from '@/components/ui';
import { patientOption, vaccineOption } from '@/lib/fields';
import { fmtDate, todayISO } from '@/lib/utils';

export default function Immunizations() {
  const supabase = createClient();
  const [tab, setTab] = useState('due');
  const [due, setDue] = useState<any[]>([]);

  useEffect(() => {
    if (tab !== 'due') return;
    (async () => {
      const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      const { data } = await supabase.from('immunizations').select('*, patients(id, first_name, last_name, mrn, phone), vaccines(name)').not('next_due_on', 'is', null).lte('next_due_on', soon).order('next_due_on');
      const { data: all } = await supabase.from('immunizations').select('patient_id, vaccine_id, given_on');
      // a due dose is done if a later dose of the same vaccine was given
      setDue((data || []).filter((d) => !(all || []).some((a) => a.patient_id === d.patient_id && a.vaccine_id === d.vaccine_id && a.given_on > d.given_on)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div>
      <PageHeader title="Immunizations" subtitle="Vaccines given, next doses due and the vaccine catalog." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'due', label: 'Due & overdue' }, { id: 'given', label: 'Given' }, { id: 'catalog', label: 'Vaccine catalog' }]} />
      {tab === 'due' && (
        <div className="card divide-y divide-slate-100">
          {due.length === 0 && <Empty text="No doses due in the next 30 days." />}
          {due.map((d) => {
            const overdue = String(d.next_due_on).slice(0, 10) < todayISO();
            return (
              <div key={d.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div><Link href={`/admin/patients/${d.patients?.id}`} className="font-semibold hover:text-brand-700">{d.patients?.first_name} {d.patients?.last_name}</Link>
                  <p className="text-xs text-ink-soft">{d.vaccines?.name} · dose {d.dose_number + 1} · last given {fmtDate(d.given_on)} · {d.patients?.phone}</p></div>
                <Badge tone={overdue ? 'red' : 'amber'}>{overdue ? 'Overdue' : 'Due'} {fmtDate(d.next_due_on)}</Badge>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'given' && (
        <ResourceManager embedded table="immunizations" title="Immunizations" select="*, patients(first_name, last_name, mrn), vaccines(name)" orderBy={{ column: 'given_on', ascending: false }}
          columns={[
            { key: 'given_on', label: 'Date', render: (r) => fmtDate(r.given_on) },
            { key: 'patient', label: 'Patient', render: (r) => <span className="font-semibold">{r.patients?.first_name} {r.patients?.last_name}</span> },
            { key: 'vaccine', label: 'Vaccine', render: (r) => `${r.vaccines?.name} · dose ${r.dose_number}` },
            { key: 'lot_number', label: 'Lot', hideOnMobile: true },
            { key: 'next_due_on', label: 'Next due', render: (r) => fmtDate(r.next_due_on) },
          ]}
          fields={[
            { name: 'patient_id', label: 'Patient', type: 'select', required: true, optionsFrom: patientOption },
            { name: 'vaccine_id', label: 'Vaccine', type: 'select', required: true, optionsFrom: vaccineOption },
            { name: 'dose_number', label: 'Dose number', type: 'number', required: true },
            { name: 'given_on', label: 'Date given', type: 'date', required: true },
            { name: 'lot_number', label: 'Lot number' }, { name: 'manufacturer', label: 'Manufacturer' },
            { name: 'site', label: 'Site', type: 'select', options: ['Left deltoid', 'Right deltoid', 'Left thigh', 'Right thigh', 'Oral', 'Intranasal'].map((v) => ({ value: v, label: v })) },
            { name: 'route', label: 'Route', type: 'select', options: ['IM', 'SC', 'ID', 'Oral', 'Intranasal'].map((v) => ({ value: v, label: v })) },
            { name: 'next_due_on', label: 'Next due (leave blank to calculate)', type: 'date' },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          defaults={{ dose_number: 1, given_on: todayISO(), route: 'IM' }}
        />
      )}
      {tab === 'catalog' && (
        <ResourceManager embedded table="vaccines" title="Vaccines" orderBy={{ column: 'name', ascending: true }} searchColumns={['name', 'cvx_code']}
          columns={[
            { key: 'name', label: 'Vaccine', render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'cvx_code', label: 'CVX' }, { key: 'doses_required', label: 'Doses' },
            { key: 'interval_days', label: 'Days between doses', hideOnMobile: true }, { key: 'booster_days', label: 'Booster after (days)', hideOnMobile: true },
            { key: 'notes', label: 'Notes', hideOnMobile: true },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true }, { name: 'cvx_code', label: 'CVX code' }, { name: 'doses_required', label: 'Doses in series', type: 'number' },
            { name: 'interval_days', label: 'Days between doses', type: 'number' }, { name: 'booster_days', label: 'Booster after series (days)', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          defaults={{ doses_required: 1 }}
        />
      )}
      <p className="mt-4 text-xs text-ink-muted">Schedules in the catalog are simplified defaults. Always follow current CDC/ACIP recommendations.</p>
    </div>
  );
}
