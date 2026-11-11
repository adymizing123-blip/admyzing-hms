'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Modal, Alert, Spinner, StatusBadge, Empty, Tabs } from '@/components/ui';
import MAR from '@/components/admin/MAR';
import { fmtDate, fmtDateTime, fullName, money } from '@/lib/utils';

export default function AdmissionPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [a, setA] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [vit, setVit] = useState({ bp: '', pulse: '', temp: '', spo2: '' });
  const [freeBeds, setFreeBeds] = useState<any[]>([]);
  const [modal, setModal] = useState<'' | 'transfer' | 'discharge'>('');
  const [newBed, setNewBed] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('mar');

  const load = useCallback(async () => {
    const [{ data }, { data: n }] = await Promise.all([
      supabase.from('admissions').select('*, patients(*), doctors(full_name), beds(bed_no, wards(name, daily_rate)), invoices(id, invoice_no, total, status)').eq('id', id).single(),
      supabase.from('nursing_notes').select('*, profiles(full_name)').eq('admission_id', id).order('created_at', { ascending: false }),
    ]);
    setA(data); setNotes(n || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('nursing_notes').insert({ admission_id: id, note, vitals: Object.fromEntries(Object.entries(vit).filter(([, v]) => v)), created_by: user?.id });
    if (error) return alert(error.message);
    setNote(''); setVit({ bp: '', pulse: '', temp: '', spo2: '' }); load();
  };

  const openTransfer = async () => {
    const { data } = await supabase.from('beds').select('id, bed_no, wards(name)').eq('status', 'available').order('bed_no');
    setFreeBeds(data || []); setModal('transfer'); setErr('');
  };

  const run = async (fn: () => PromiseLike<{ error: any }>) => {
    setBusy(true); setErr('');
    const { error } = await fn();
    setBusy(false);
    if (error) return setErr(error.message);
    setModal(''); load();
  };

  if (!a) return <div className="flex justify-center py-20"><Spinner /></div>;
  const days = Math.max(1, Math.ceil((((a.discharged_at ? new Date(a.discharged_at) : new Date()).getTime()) - new Date(a.admitted_at).getTime()) / 86400000));

  return (
    <div className="space-y-6">
      <Link href="/admin/ipd" className="text-sm font-semibold text-brand-700">← Bed board</Link>
      <div className="card p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-xl font-bold">{fullName(a.patients)}</h1><StatusBadge status={a.status} /></div>
            <p className="text-sm text-ink-soft">{a.patients.mrn} · {a.beds?.wards?.name} · Bed {a.beds?.bed_no} · {a.doctors?.full_name || 'No attending doctor'}</p>
            <p className="mt-1 text-sm">Admitted {fmtDateTime(a.admitted_at)} · {days} day(s) · est. room charges {money(days * Number(a.beds?.wards?.daily_rate || 0))}</p>
            {a.reason && <p className="mt-2 text-sm"><span className="font-semibold">Reason:</span> {a.reason}</p>}
            {a.patients.allergies && <p className="mt-2 text-sm font-semibold text-rose-600">Allergies: {a.patients.allergies}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/patients/${a.patient_id}`} className="btn-secondary btn-sm">Patient record</Link>
            {a.status === 'admitted' && <>
              <button className="btn-secondary btn-sm" onClick={openTransfer}>Transfer bed</button>
              <button className="btn-primary btn-sm" onClick={() => { setModal('discharge'); setErr(''); }}>Discharge</button>
            </>}
            {a.invoices && <Link href={`/admin/billing/${a.invoices.id}`} className="btn-primary btn-sm">Bill {a.invoices.invoice_no}</Link>}
          </div>
        </div>
        {a.discharge_summary && <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm"><p className="font-semibold">Discharged {fmtDate(a.discharged_at)}</p><p className="mt-1 whitespace-pre-wrap">{a.discharge_summary}</p></div>}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'mar', label: 'Medications (MAR)' }, { id: 'notes', label: `Nursing notes (${notes.length})` }, { id: 'diet', label: 'Diet' }]} />

      {tab === 'mar' && <MAR admissionId={a.id} active={a.status === 'admitted'} />}

      {tab === 'diet' && <DietPanel admissionId={a.id} />}

      {tab === 'notes' && <div className="grid gap-6 lg:grid-cols-3">
        {a.status === 'admitted' && (
          <form onSubmit={addNote} className="card h-fit space-y-3 p-5">
            <h2 className="font-bold">Add nursing note</h2>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(vit).map((k) => <input key={k} className="input" placeholder={k.toUpperCase()} value={(vit as any)[k]} onChange={(e) => setVit({ ...vit, [k]: e.target.value })} />)}
            </div>
            <textarea className="input min-h-[100px]" required placeholder="Observations, medication given, etc." value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn-primary w-full">Save note</button>
          </form>
        )}
        <div className={a.status === 'admitted' ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <h2 className="mb-3 font-bold">Nursing notes</h2>
          <div className="card divide-y divide-slate-100">
            {notes.length === 0 && <Empty text="No notes yet." />}
            {notes.map((n) => (
              <div key={n.id} className="p-4">
                <div className="flex justify-between text-xs text-ink-muted"><span>{n.profiles?.full_name || 'Staff'}</span><span>{fmtDateTime(n.created_at)}</span></div>
                {Object.keys(n.vitals || {}).length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(n.vitals).map(([k, v]) => <span key={k} className="rounded bg-slate-100 px-2 py-0.5 text-xs"><b className="uppercase">{k}</b> {String(v)}</span>)}</div>}
                <p className="mt-2 whitespace-pre-wrap text-sm">{n.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>}

      <Modal open={modal === 'transfer'} onClose={() => setModal('')} title="Transfer to another bed">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <select className="input" value={newBed} onChange={(e) => setNewBed(e.target.value)}>
            <option value="">Select available bed...</option>
            {freeBeds.map((b) => <option key={b.id} value={b.id}>{b.wards?.name} · {b.bed_no}</option>)}
          </select>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button>
            <button className="btn-primary" disabled={!newBed || busy} onClick={() => run(() => supabase.rpc('transfer_bed', { p_admission: id, p_new_bed: newBed }))}>{busy && <Spinner />} Transfer</button></div>
        </div>
      </Modal>

      <Modal open={modal === 'discharge'} onClose={() => setModal('')} title="Discharge patient">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <p className="text-sm text-ink-soft">A bill is created automatically for {days} day(s) of room charges plus every medicine given on the MAR. Active medication orders are stopped. You can add procedures to the bill afterwards.</p>
          <textarea className="input min-h-[140px]" placeholder="Discharge summary: diagnosis, treatment given, condition at discharge, medications, follow-up..." value={summary} onChange={(e) => setSummary(e.target.value)} />
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={() => run(() => supabase.rpc('discharge_patient', { p_admission: id, p_summary: summary }))}>{busy && <Spinner />} Discharge & bill</button></div>
        </div>
      </Modal>
    </div>
  );
}

function DietPanel({ admissionId }: { admissionId: string }) {
  const supabase = createClient();
  const [diet, setDiet] = useState<any[]>([]);
  const [meals, setMeals] = useState<any[]>([]);
  useEffect(() => {
    supabase.from('diet_orders').select('*').eq('admission_id', admissionId).order('created_at', { ascending: false }).then(({ data }) => setDiet(data || []));
    supabase.from('meal_service').select('*').eq('admission_id', admissionId).order('service_date', { ascending: false }).limit(30).then(({ data }) => setMeals(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId]);
  const active = diet.find((d) => d.status === 'active');
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Current diet</h2><Link href="/admin/kitchen" className="btn-secondary btn-sm">Change in kitchen board</Link></div>
        {active ? (
          <div className="space-y-1 text-sm">
            <p className="text-lg font-bold">{active.diet_type}</p>
            {active.texture && <p>Texture: {active.texture}</p>}
            {active.fluid_limit_ml && <p>Fluid limit: {active.fluid_limit_ml} mL/day</p>}
            {active.food_allergies && <p className="font-semibold text-rose-600">Allergies: {active.food_allergies}</p>}
            {active.instructions && <p className="text-ink-soft">{active.instructions}</p>}
          </div>
        ) : <Empty text="No diet order yet." />}
      </div>
      <div className="card p-5">
        <h2 className="mb-3 font-bold">Recent meals</h2>
        {meals.length === 0 ? <Empty text="No meals recorded." /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {meals.map((m) => <li key={m.id} className="flex justify-between py-2"><span className="capitalize">{String(m.service_date).slice(0, 10)} · {m.meal}</span><StatusBadge status={m.status === 'served' ? 'completed' : m.status === 'refused' ? 'denied' : 'pending'} /></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
