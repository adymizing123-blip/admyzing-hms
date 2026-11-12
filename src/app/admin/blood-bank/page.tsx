'use client';
import { useCallback, useEffect, useState } from 'react';
import { Droplets } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { Modal, PageHeader, Tabs, Badge, StatusBadge, Alert, Spinner } from '@/components/ui';
import { patientOption } from '@/lib/fields';
import { cn, fmtDate, fmtDateTime, todayISO } from '@/lib/utils';

const GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const COMPONENTS = ['Packed red cells', 'Whole blood', 'Plasma', 'Platelets', 'Cryoprecipitate'];
const SHELF: Record<string, number> = { 'Packed red cells': 42, 'Whole blood': 35, Plasma: 365, Platelets: 5, Cryoprecipitate: 365 };
const groupOpts = GROUPS.map((g) => ({ value: g, label: g }));
const compOpts = COMPONENTS.map((c) => ({ value: c, label: c }));

// same rule as the database function blood_compatible()
function compatible(donor: string, recipient: string, component: string) {
  const d = donor.replace(/[+-]/, ''), r = recipient.replace(/[+-]/, '');
  if (component === 'Plasma' || component === 'Cryoprecipitate') return d === 'AB' || d === r || r === 'O';
  if (component === 'Platelets') return true;
  return (donor.endsWith('-') || recipient.endsWith('+')) && (d === 'O' || d === r || r === 'AB');
}

export default function BloodBank() {
  const supabase = createClient();
  const [tab, setTab] = useState('stock');
  const [units, setUnits] = useState<any[]>([]);
  const [issueFor, setIssueFor] = useState<any>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reload, setReload] = useState(0);
  const today = todayISO();

  const load = useCallback(async () => {
    const { data } = await supabase.from('blood_units').select('*').eq('status', 'available').order('expires_on');
    setUnits(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);
  useEffect(() => { load(); }, [load]);

  const live = units.filter((u) => String(u.expires_on).slice(0, 10) >= today);
  const expiringSoon = live.filter((u) => new Date(u.expires_on).getTime() - Date.now() < 5 * 864e5);
  const expired = units.filter((u) => String(u.expires_on).slice(0, 10) < today);

  const issue = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('blood_issue', { p_request: issueFor.id, p_units: picked });
    setBusy(false);
    if (error) return setErr(error.message);
    setIssueFor(null); setPicked([]); setReload((x) => x + 1);
  };

  const candidates = issueFor ? live.filter((u) => u.component === issueFor.component && compatible(u.blood_group, issueFor.blood_group, u.component))
    .sort((a, b) => Number(b.blood_group === issueFor.blood_group) - Number(a.blood_group === issueFor.blood_group)) : [];

  return (
    <div>
      <PageHeader title="Blood Bank" subtitle="Inventory by group, donors, transfusion requests and compatibility-checked issuing." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'stock', label: 'Stock' }, { id: 'requests', label: 'Requests' }, { id: 'units', label: 'Units' }, { id: 'donors', label: 'Donors' }]} />

      {tab === 'stock' && (
        <div className="space-y-5">
          {(expiringSoon.length > 0 || expired.length > 0) && (
            <Alert tone="amber">{expiringSoon.length} unit(s) expire within 5 days.{expired.length > 0 && ` ${expired.length} expired unit(s) still marked available: discard them in the Units tab.`}</Alert>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {GROUPS.map((g) => {
              const n = live.filter((u) => u.blood_group === g && u.component === 'Packed red cells').length;
              return (
                <div key={g} className={cn('card p-4', n < 2 && 'border-rose-200 bg-rose-50/50')}>
                  <div className="flex items-center justify-between"><span className="text-2xl font-extrabold">{g}</span><Droplets className={n < 2 ? 'text-rose-500' : 'text-brand-600'} size={20} /></div>
                  <p className="mt-2 text-sm"><b>{n}</b> red cell unit(s)</p>
                  <p className="text-xs text-ink-muted">{live.filter((u) => u.blood_group === g && u.component !== 'Packed red cells').length} other component(s)</p>
                  {n < 2 && <p className="mt-1 text-xs font-semibold text-rose-600">Low stock</p>}
                </div>
              );
            })}
          </div>
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/60"><tr><th className="th">Component</th>{GROUPS.map((g) => <th key={g} className="th text-center">{g}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {COMPONENTS.map((c) => (
                  <tr key={c}><td className="td font-medium">{c}</td>{GROUPS.map((g) => <td key={g} className="td text-center">{live.filter((u) => u.blood_group === g && u.component === c).length || '-'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'requests' && (
        <ResourceManager embedded table="blood_requests" branchVia="patients" title="Transfusion requests" select="*, patients(first_name, last_name, mrn)" reloadKey={reload}
          columns={[
            { key: 'request_no', label: 'Request', render: (r) => <div><p className="font-semibold">{r.request_no}</p><p className="text-xs text-ink-muted">{fmtDateTime(r.created_at)}</p></div> },
            { key: 'patient', label: 'Patient', render: (r) => `${r.patients?.first_name} ${r.patients?.last_name}` },
            { key: 'need', label: 'Needs', render: (r) => <span><b>{r.units_needed}×</b> {r.component} <Badge tone="red">{r.blood_group}</Badge></span> },
            { key: 'urgency', label: 'Urgency', render: (r) => <Badge tone={r.urgency === 'emergency' ? 'red' : r.urgency === 'urgent' ? 'amber' : 'gray'}>{r.urgency}</Badge> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status === 'issued' ? 'completed' : r.status === 'crossmatched' ? 'approved' : r.status} /> },
          ]}
          rowActions={(r) => ['pending', 'crossmatched'].includes(r.status) ? <button className="btn-primary btn-sm" onClick={() => { setIssueFor(r); setPicked([]); setErr(''); }}>Issue units</button> : null}
          fields={[
            { name: 'patient_id', label: 'Patient', type: 'select', required: true, optionsFrom: patientOption },
            { name: 'blood_group', label: 'Patient blood group', type: 'select', required: true, options: groupOpts },
            { name: 'component', label: 'Component', type: 'select', required: true, options: compOpts },
            { name: 'units_needed', label: 'Units needed', type: 'number', required: true },
            { name: 'urgency', label: 'Urgency', type: 'select', options: ['routine', 'urgent', 'emergency'].map((v) => ({ value: v, label: v })) },
            { name: 'status', label: 'Status', type: 'select', options: ['pending', 'crossmatched', 'cancelled'].map((v) => ({ value: v, label: v })) },
            { name: 'crossmatch_result', label: 'Crossmatch result' },
            { name: 'indication', label: 'Indication', type: 'textarea' },
          ]}
          defaults={{ component: 'Packed red cells', units_needed: 1, urgency: 'routine', status: 'pending' }}
        />
      )}

      {tab === 'units' && (
        <ResourceManager embedded table="blood_units" title="Blood units" select="*, blood_donors(full_name)" orderBy={{ column: 'expires_on', ascending: true }} searchColumns={['unit_no', 'blood_group']} branchScoped reloadKey={reload}
          columns={[
            { key: 'unit_no', label: 'Unit', render: (r) => <span className="font-mono font-semibold">{r.unit_no}</span> },
            { key: 'blood_group', label: 'Group', render: (r) => <Badge tone="red">{r.blood_group}</Badge> },
            { key: 'component', label: 'Component' },
            { key: 'expires_on', label: 'Expires', render: (r) => <span className={String(r.expires_on).slice(0, 10) < today ? 'font-bold text-rose-600' : ''}>{fmtDate(r.expires_on)}</span> },
            { key: 'donor', label: 'Donor', render: (r) => r.blood_donors?.full_name || '-', hideOnMobile: true },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'available' ? 'green' : r.status === 'issued' ? 'blue' : 'gray'}>{r.status}</Badge> },
          ]}
          fields={[
            { name: 'unit_no', label: 'Unit number (bag label)', required: true },
            { name: 'blood_group', label: 'Group', type: 'select', required: true, options: groupOpts },
            { name: 'component', label: 'Component', type: 'select', required: true, options: compOpts },
            { name: 'volume_ml', label: 'Volume (mL)', type: 'number' },
            { name: 'collected_on', label: 'Collected on', type: 'date', required: true },
            { name: 'expires_on', label: `Expires on (red cells ${SHELF['Packed red cells']} days, platelets ${SHELF.Platelets})`, type: 'date', required: true },
            { name: 'donor_id', label: 'Donor', type: 'select', optionsFrom: { table: 'blood_donors', select: 'id, full_name, blood_group', label: (r: any) => `${r.full_name} (${r.blood_group})`, order: 'full_name' } },
            { name: 'status', label: 'Status', type: 'select', options: ['available', 'reserved', 'issued', 'discarded'].map((v) => ({ value: v, label: v })) },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          defaults={{ component: 'Packed red cells', volume_ml: 350, status: 'available', collected_on: today, expires_on: new Date(Date.now() + 42 * 864e5).toISOString().slice(0, 10) }}
        />
      )}

      {tab === 'donors' && (
        <ResourceManager embedded table="blood_donors" title="Donors" orderBy={{ column: 'full_name', ascending: true }} searchColumns={['full_name', 'phone', 'blood_group']}
          columns={[
            { key: 'full_name', label: 'Donor', render: (r) => <span className="font-semibold">{r.full_name}</span> },
            { key: 'blood_group', label: 'Group', render: (r) => <Badge tone="red">{r.blood_group}</Badge> },
            { key: 'phone', label: 'Phone' },
            { key: 'last_donation', label: 'Last donation', render: (r) => fmtDate(r.last_donation) },
            { key: 'next', label: 'Can donate again', render: (r) => r.last_donation ? fmtDate(new Date(new Date(r.last_donation).getTime() + 56 * 864e5)) : 'Now', hideOnMobile: true },
            { key: 'eligible', label: 'Eligible', render: (r) => <Badge tone={r.eligible ? 'green' : 'gray'}>{r.eligible ? 'Yes' : 'No'}</Badge> },
          ]}
          fields={[
            { name: 'full_name', label: 'Full name', required: true }, { name: 'blood_group', label: 'Blood group', type: 'select', required: true, options: groupOpts },
            { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'dob', label: 'Date of birth', type: 'date' },
            { name: 'last_donation', label: 'Last donation', type: 'date' }, { name: 'eligible', label: 'Eligible to donate', type: 'checkbox' }, { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          defaults={{ eligible: true }}
        />
      )}

      <Modal open={!!issueFor} onClose={() => setIssueFor(null)} title={`Issue for ${issueFor?.request_no || ''}`} wide>
        {issueFor && (
          <div className="space-y-4">
            {err && <Alert>{err}</Alert>}
            <p className="text-sm">Patient needs <b>{issueFor.units_needed}× {issueFor.component}</b>, group <b>{issueFor.blood_group}</b>. Only compatible, unexpired units are listed (same group first).</p>
            {candidates.length === 0 ? <Alert>No compatible units in stock.</Alert> : (
              <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
                {candidates.map((u) => {
                  const on = picked.includes(u.id);
                  return (
                    <button key={u.id} type="button" onClick={() => setPicked(on ? picked.filter((x) => x !== u.id) : [...picked, u.id])}
                      className={cn('flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm ring-1', on ? 'bg-brand-50 ring-brand-400' : 'ring-slate-200')}>
                      <span className="font-mono font-semibold">{u.unit_no}</span><span><Badge tone="red">{u.blood_group}</Badge> <span className="text-xs text-ink-muted">exp {fmtDate(u.expires_on)}</span></span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setIssueFor(null)}>Cancel</button><button className="btn-primary" disabled={busy || picked.length === 0} onClick={issue}>{busy && <Spinner />} Issue {picked.length} unit(s)</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
