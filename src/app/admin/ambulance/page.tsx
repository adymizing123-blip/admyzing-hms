'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Ambulance as AmbIcon, Phone, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { Modal, PageHeader, Tabs, Badge, Alert, Spinner, Empty } from '@/components/ui';
import PatientPicker, { type PickedPatient } from '@/components/admin/PatientPicker';
import { useBranch } from '@/components/admin/branch';
import { cn, fmtDateTime, fmtTime, money, titleCase } from '@/lib/utils';

const FLOW = ['requested', 'dispatched', 'at_pickup', 'transporting', 'completed'];
const NEXT: Record<string, string> = { dispatched: 'At pickup', at_pickup: 'Transporting', transporting: 'Completed' };

export default function AmbulancePage() {
  const supabase = createClient();
  const { branchId } = useBranch();
  const [tab, setTab] = useState('board');
  const [fleet, setFleet] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [dispatch, setDispatch] = useState<any>(null);
  const [amb, setAmb] = useState('');
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    let a = supabase.from('ambulances').select('*').order('vehicle_no');
    let t = supabase.from('ambulance_trips').select('*, ambulances(vehicle_no), patients(first_name, last_name, mrn)').in('status', ['requested', 'dispatched', 'at_pickup', 'transporting']).order('created_at');
    if (branchId) { a = a.eq('branch_id', branchId); t = t.eq('branch_id', branchId); }
    const [{ data: fa }, { data: ft }] = await Promise.all([a, t]);
    setFleet(fa || []); setTrips(ft || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    load();
    const ch = supabase.channel('amb').on('postgres_changes', { event: '*', schema: 'public', table: 'ambulance_trips' }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const setStatus = async (trip: any, status: string, ambulance?: string) => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('trip_set_status', { p_trip: trip.id, p_status: status, p_ambulance: ambulance || null });
    setBusy(false);
    if (error) { setErr(error.message); alert(error.message); return; }
    setDispatch(null); load();
  };

  const create = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('ambulance_trips').insert({
      patient_id: patient?.id || null, caller_name: f.caller_name, caller_phone: f.caller_phone, pickup_address: f.pickup_address,
      destination: f.destination || null, trip_type: f.trip_type, priority: f.priority, scheduled_for: f.scheduled_for ? new Date(f.scheduled_for).toISOString() : null,
      charge: Number(f.charge) || 0, notes: f.notes || null, source: 'phone',
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false); load();
  };

  return (
    <div>
      <PageHeader title="Ambulance" subtitle="Fleet status, trip requests and dispatch. Website requests appear here automatically."
        actions={<button className="btn-primary" onClick={() => { setOpen(true); setErr(''); setPatient(null); setF({ trip_type: 'transfer', priority: 'normal', charge: '450' }); }}><Plus size={16} /> New trip</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'board', label: 'Dispatch board' }, { id: 'history', label: 'Trip history' }, { id: 'fleet', label: 'Fleet' }]} />

      {tab === 'board' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {fleet.map((a) => (
              <div key={a.id} className="card flex items-center gap-3 p-4">
                <span className={cn('grid h-11 w-11 place-items-center rounded-xl', a.status === 'available' ? 'bg-emerald-50 text-emerald-600' : a.status === 'on_trip' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500')}><AmbIcon size={20} /></span>
                <div className="min-w-0 flex-1"><p className="font-bold">{a.vehicle_no} <span className="text-xs font-normal text-ink-muted">{a.vehicle_type}</span></p><p className="truncate text-xs text-ink-soft">{a.driver_name} · {a.driver_phone}</p></div>
                <Badge tone={a.status === 'available' ? 'green' : a.status === 'on_trip' ? 'red' : 'gray'}>{titleCase(a.status)}</Badge>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {trips.length === 0 && <div className="card"><Empty text="No active trips." /></div>}
            {trips.map((t) => (
              <div key={t.id} className={cn('card p-4', t.priority === 'critical' && 'ring-2 ring-rose-300')}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="font-bold">{t.trip_no} · {t.caller_name} <Badge tone={t.priority === 'critical' ? 'red' : t.priority === 'urgent' ? 'amber' : 'gray'}>{t.priority}</Badge> {t.source === 'web' && <Badge tone="violet">Website</Badge>}</p>
                    <p className="mt-1 flex items-center gap-1 text-sm"><MapPin size={14} className="text-brand-600" /> {t.pickup_address} → {t.destination || 'CarePlus'}</p>
                    <p className="flex items-center gap-1 text-xs text-ink-soft"><Phone size={12} /> {t.caller_phone} · {titleCase(t.trip_type)}{t.scheduled_for ? ` · for ${fmtDateTime(t.scheduled_for)}` : ''}{t.patients ? ` · ${t.patients.first_name} ${t.patients.last_name}` : ''}</p>
                    {t.notes && <p className="mt-1 text-xs text-ink-muted">{t.notes}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {t.status === 'requested'
                      ? <button className="btn-primary btn-sm" onClick={() => { setDispatch(t); setAmb(fleet.find((a) => a.status === 'available')?.id || ''); }}>Dispatch</button>
                      : NEXT[t.status] && <button className="btn-primary btn-sm" disabled={busy} onClick={() => setStatus(t, FLOW[FLOW.indexOf(t.status) + 1])}>{NEXT[t.status]}</button>}
                    <button className="btn-ghost btn-sm text-rose-600" onClick={() => confirm('Cancel this trip?') && setStatus(t, 'cancelled')}>Cancel</button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1">
                  {FLOW.map((s, i) => {
                    const reached = FLOW.indexOf(t.status) >= i;
                    const at = { dispatched: t.dispatched_at, at_pickup: t.at_pickup_at, transporting: t.transporting_at, completed: t.completed_at, requested: t.created_at }[s];
                    return (
                      <div key={s} className="flex-1">
                        <div className={cn('h-1.5 rounded-full', reached ? 'bg-brand-500' : 'bg-slate-200')} />
                        <p className={cn('mt-1 text-[10px] font-semibold', reached ? 'text-brand-700' : 'text-ink-muted')}>{titleCase(s)}{at && reached ? ` ${fmtTime(at)}` : ''}</p>
                      </div>
                    );
                  })}
                </div>
                {t.ambulances && <p className="mt-2 text-xs text-ink-soft">Vehicle {t.ambulances.vehicle_no}</p>}
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-muted">Statuses are updated by dispatch staff. Live GPS tracking needs a vehicle tracking device or driver app connected to this system.</p>
        </div>
      )}

      {tab === 'history' && (
        <ResourceManager embedded table="ambulance_trips" title="Trips" select="*, ambulances(vehicle_no)" canCreate={false} branchScoped searchColumns={['trip_no', 'caller_name', 'pickup_address']}
          columns={[
            { key: 'trip_no', label: 'Trip', render: (r) => <span className="font-semibold">{r.trip_no}</span> },
            { key: 'created_at', label: 'Requested', render: (r) => fmtDateTime(r.created_at) },
            { key: 'caller_name', label: 'Caller' },
            { key: 'route', label: 'Route', render: (r) => <span className="text-xs">{r.pickup_address} → {r.destination || 'CarePlus'}</span>, hideOnMobile: true },
            { key: 'veh', label: 'Vehicle', render: (r) => r.ambulances?.vehicle_no || '-', hideOnMobile: true },
            { key: 'charge', label: 'Charge', render: (r) => money(r.charge) },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'completed' ? 'green' : r.status === 'cancelled' ? 'gray' : 'amber'}>{titleCase(r.status)}</Badge> },
          ]}
          fields={[{ name: 'charge', label: 'Charge ($)', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea' }]}
          canDelete={false}
        />
      )}

      {tab === 'fleet' && (
        <ResourceManager embedded table="ambulances" title="Vehicles" branchScoped orderBy={{ column: 'vehicle_no', ascending: true }}
          columns={[
            { key: 'vehicle_no', label: 'Vehicle', render: (r) => <span className="font-semibold">{r.vehicle_no}</span> },
            { key: 'vehicle_type', label: 'Type' }, { key: 'driver_name', label: 'Driver' }, { key: 'driver_phone', label: 'Phone', hideOnMobile: true },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'available' ? 'green' : r.status === 'on_trip' ? 'red' : 'gray'}>{titleCase(r.status)}</Badge> },
          ]}
          fields={[
            { name: 'vehicle_no', label: 'Vehicle number', required: true },
            { name: 'vehicle_type', label: 'Type', type: 'select', options: ['BLS', 'ALS', 'Patient transport'].map((v) => ({ value: v, label: v })) },
            { name: 'driver_name', label: 'Driver' }, { name: 'driver_phone', label: 'Driver phone', type: 'tel' },
            { name: 'status', label: 'Status', type: 'select', options: ['available', 'on_trip', 'maintenance'].map((v) => ({ value: v, label: titleCase(v) })) },
          ]}
          defaults={{ vehicle_type: 'BLS', status: 'available' }}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New ambulance trip" wide>
        <div className="grid gap-4 sm:grid-cols-2">
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
          <div className="sm:col-span-2"><span className="label">Patient (optional)</span><PatientPicker value={patient} onChange={(p) => { setPatient(p); if (p) setF({ ...f, caller_name: f.caller_name || `${p.first_name} ${p.last_name}`, caller_phone: f.caller_phone || p.phone || '' }); }} /></div>
          {[['caller_name', 'Caller name'], ['caller_phone', 'Caller phone'], ['pickup_address', 'Pickup address'], ['destination', 'Destination']].map(([k, l]) => (
            <label key={k} className="block"><span className="label">{l}</span><input className="input" value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
          <label className="block"><span className="label">Type</span><select className="input" value={f.trip_type} onChange={(e) => setF({ ...f, trip_type: e.target.value })}>{['emergency', 'transfer', 'discharge', 'appointment'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select></label>
          <label className="block"><span className="label">Priority</span><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['normal', 'urgent', 'critical'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</select></label>
          <label className="block"><span className="label">Scheduled for (optional)</span><input type="datetime-local" className="input" value={f.scheduled_for || ''} onChange={(e) => setF({ ...f, scheduled_for: e.target.value })} /></label>
          <label className="block"><span className="label">Charge ($, billed to patient on completion)</span><input className="input" value={f.charge} onChange={(e) => setF({ ...f, charge: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">Notes</span><textarea className="input" value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy || !f.caller_name || !f.caller_phone || !f.pickup_address} onClick={create}>{busy && <Spinner />} Create trip</button></div>
        </div>
      </Modal>

      <Modal open={!!dispatch} onClose={() => setDispatch(null)} title={`Dispatch ${dispatch?.trip_no || ''}`}>
        <div className="space-y-4">
          <select className="input" value={amb} onChange={(e) => setAmb(e.target.value)}>
            <option value="">Choose vehicle...</option>
            {fleet.filter((a) => a.status === 'available').map((a) => <option key={a.id} value={a.id}>{a.vehicle_no} · {a.vehicle_type} · {a.driver_name}</option>)}
          </select>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setDispatch(null)}>Cancel</button><button className="btn-primary" disabled={!amb || busy} onClick={() => setStatus(dispatch, 'dispatched', amb)}>{busy && <Spinner />} Dispatch</button></div>
        </div>
      </Modal>
    </div>
  );
}
