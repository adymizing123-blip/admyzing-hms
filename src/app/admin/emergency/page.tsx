'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Timer, Activity } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, PageHeader, Alert, Spinner, Empty, Badge } from '@/components/ui';
import PatientPicker, { type PickedPatient } from '@/components/admin/PatientPicker';
import { useBranch } from '@/components/admin/branch';
import { cn, fmtTime, fullName, age, titleCase } from '@/lib/utils';

const ESI = [
  { level: 1, label: 'Resuscitation', desc: 'Immediate life-saving intervention', cls: 'bg-rose-600 text-white', ring: 'ring-rose-300' },
  { level: 2, label: 'Emergent', desc: 'High risk, confused, severe pain', cls: 'bg-orange-500 text-white', ring: 'ring-orange-300' },
  { level: 3, label: 'Urgent', desc: 'Stable, needs 2+ resources', cls: 'bg-amber-400 text-amber-950', ring: 'ring-amber-300' },
  { level: 4, label: 'Less urgent', desc: 'Stable, 1 resource', cls: 'bg-emerald-500 text-white', ring: 'ring-emerald-300' },
  { level: 5, label: 'Non-urgent', desc: 'Stable, no resources', cls: 'bg-sky-500 text-white', ring: 'ring-sky-300' },
];
const esi = (l?: number | null) => ESI.find((e) => e.level === l);
const mins = (from: string) => Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 60000));

export default function Emergency() {
  const supabase = createClient();
  const { branchId } = useBranch();
  const [rows, setRows] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [modal, setModal] = useState<'' | 'new' | 'triage' | 'treat' | 'dispo'>('');
  const [sel, setSel] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    let q = supabase.from('er_visits').select('*, patients(id, first_name, last_name, mrn, dob, gender, allergies), doctors(full_name)')
      .or(`status.in.(waiting,in_treatment),disposition_at.gte.${since}`).order('arrived_at');
    if (branchId) q = q.eq('branch_id', branchId);
    const { data } = await q;
    setRows(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    load();
    supabase.from('doctors').select('id, full_name').eq('active', true).order('full_name').then(({ data }) => setDoctors(data || []));
    const ch = supabase.channel('er-board').on('postgres_changes', { event: '*', schema: 'public', table: 'er_visits' }, () => load()).subscribe();
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const open = (m: typeof modal, r: any = null) => {
    setSel(r); setErr('');
    setF(m === 'triage' ? { triage_level: r?.triage_level || 3, pain_score: r?.pain_score ?? '', area: r?.area || '', ...(r?.vitals || {}) }
      : m === 'treat' ? { doctor_id: r?.doctor_id || '', area: r?.area || '' }
        : m === 'dispo' ? { status: 'discharged', disposition_notes: '' }
          : { arrival_mode: 'walk_in', chief_complaint: '', gender: 'male' });
    setPatient(null); setUnknown(false); setModal(m);
  };

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('');
    try { await fn(); setModal(''); load(); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  const chk = <T extends { error: any }>(r: T): T => { if (r.error) throw r.error; return r; };

  const register = () => run(async () => {
    let pid = patient?.id;
    if (unknown) {
      const { data } = chk(await supabase.from('patients').insert({ first_name: 'Unknown', last_name: `${f.gender === 'female' ? 'Female' : 'Male'} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, gender: f.gender }).select('id').single());
      pid = data.id;
    }
    if (!pid) throw new Error('Choose the patient or tick "Unknown patient"');
    chk(await supabase.from('er_visits').insert({ patient_id: pid, arrival_mode: f.arrival_mode, chief_complaint: f.chief_complaint }));
  });

  const triage = () => run(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const vitals = Object.fromEntries(['bp', 'pulse', 'resp', 'temp', 'spo2'].filter((k) => f[k]).map((k) => [k, f[k]]));
    chk(await supabase.from('er_visits').update({ triage_level: Number(f.triage_level), pain_score: f.pain_score === '' ? null : Number(f.pain_score), area: f.area || null, vitals, triaged_by: user?.id, triaged_at: new Date().toISOString() }).eq('id', sel.id));
  });

  const treat = () => run(async () => {
    chk(await supabase.from('er_visits').update({ status: 'in_treatment', doctor_id: f.doctor_id || null, area: f.area || null, seen_at: sel.seen_at || new Date().toISOString() }).eq('id', sel.id));
  });

  const dispo = () => run(async () => {
    chk(await supabase.from('er_visits').update({ status: f.status, disposition_notes: f.disposition_notes || null, disposition_at: new Date().toISOString() }).eq('id', sel.id));
    if (f.status === 'admitted') window.location.href = `/admin/ipd?admit=${sel.patient_id}`;
  });

  const waiting = rows.filter((r) => r.status === 'waiting').sort((a, b) => (a.triage_level || 9) - (b.triage_level || 9) || a.arrived_at.localeCompare(b.arrived_at));
  const treating = rows.filter((r) => r.status === 'in_treatment').sort((a, b) => (a.triage_level || 9) - (b.triage_level || 9));
  const done = rows.filter((r) => !['waiting', 'in_treatment'].includes(r.status)).reverse();
  const avgWait = waiting.length ? Math.round(waiting.reduce((s, r) => s + mins(r.arrived_at), 0) / waiting.length) : 0;

  const Card = ({ r }: { r: any }) => {
    const e = esi(r.triage_level);
    const w = mins(r.arrived_at);
    return (
      <div className={cn('card p-3 ring-2', e ? e.ring : 'ring-slate-200')}>
        <div className="flex items-start gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg font-extrabold', e ? e.cls : 'bg-slate-200 text-slate-500')}>{r.triage_level || '?'}</span>
          <div className="min-w-0 flex-1">
            <Link href={`/admin/patients/${r.patients?.id}`} className="font-semibold hover:text-brand-700">{fullName(r.patients)}</Link>
            <p className="text-xs text-ink-soft">{r.er_no} · {age(r.patients?.dob)} {r.patients?.gender?.[0]?.toUpperCase() || ''} · {titleCase(r.arrival_mode)}</p>
            <p className="mt-1 text-sm">{r.chief_complaint}</p>
            {r.patients?.allergies && <p className="mt-1 text-[11px] font-semibold text-rose-600">Allergy: {r.patients.allergies}</p>}
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
              <span className={cn('inline-flex items-center gap-1', w > 60 && r.status === 'waiting' && 'font-semibold text-rose-600')}><Timer size={12} /> {w} min</span>
              {r.area && <span>{r.area}</span>}
              {r.doctors && <span>{r.doctors.full_name}</span>}
              {r.vitals?.bp && <span>BP {r.vitals.bp}</span>}
              {r.vitals?.spo2 && <span>SpO2 {r.vitals.spo2}%</span>}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button className="btn-secondary btn-sm" onClick={() => open('triage', r)}>{r.triage_level ? 'Re-triage' : 'Triage'}</button>
          {r.status === 'waiting' && <button className="btn-primary btn-sm" onClick={() => open('treat', r)}>Start treatment</button>}
          {r.status === 'in_treatment' && <button className="btn-secondary btn-sm" onClick={() => open('treat', r)}>Reassign</button>}
          <button className="btn-secondary btn-sm" onClick={() => open('dispo', r)}>Disposition</button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="Emergency Department" subtitle="Live ER board sorted by triage level (ESI 1 most urgent). Updates automatically."
        actions={<button className="btn-primary" onClick={() => open('new')}><Plus size={16} /> New arrival</button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Waiting', waiting.length], ['In treatment', treating.length], ['Avg wait (min)', avgWait], ['ESI 1 to 2 now', [...waiting, ...treating].filter((r) => (r.triage_level || 9) <= 2).length]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><p className="text-xs font-semibold uppercase text-ink-soft">{l}</p><p className="mt-1 text-2xl font-bold">{v}</p></div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-bold"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Waiting ({waiting.length})</h2>
          <div className="space-y-3">{waiting.length ? waiting.map((r) => <Card key={r.id} r={r} />) : <div className="card"><Empty text="No one waiting." /></div>}</div>
        </section>
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-bold"><Activity size={16} className="text-violet-600" /> In treatment ({treating.length})</h2>
          <div className="space-y-3">{treating.length ? treating.map((r) => <Card key={r.id} r={r} />) : <div className="card"><Empty text="No active patients." /></div>}</div>
        </section>
      </div>

      <h2 className="mb-3 mt-8 font-bold">Last 24 hours</h2>
      <div className="card divide-y divide-slate-100">
        {done.length === 0 && <Empty text="No completed visits." />}
        {done.map((r) => (
          <div key={r.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span><b>{fullName(r.patients)}</b> · {r.chief_complaint}</span>
            <span className="flex items-center gap-2 text-xs text-ink-muted">ESI {r.triage_level || '-'} · in {fmtTime(r.arrived_at)} · out {fmtTime(r.disposition_at)} <Badge tone={r.status === 'admitted' ? 'red' : r.status === 'discharged' ? 'green' : 'gray'}>{titleCase(r.status)}</Badge></span>
          </div>
        ))}
      </div>

      <Modal open={modal === 'new'} onClose={() => setModal('')} title="New ER arrival">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} /> Unknown patient (identify later)</label>
          {unknown ? (
            <select className="input" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
          ) : <PatientPicker value={patient} onChange={setPatient} />}
          <label className="block"><span className="label">Arrival</span>
            <select className="input" value={f.arrival_mode} onChange={(e) => setF({ ...f, arrival_mode: e.target.value })}>
              <option value="walk_in">Walk-in</option><option value="ambulance">Ambulance</option><option value="police">Police</option><option value="transfer">Transfer</option>
            </select></label>
          <label className="block"><span className="label">Chief complaint</span><input className="input" required value={f.chief_complaint} onChange={(e) => setF({ ...f, chief_complaint: e.target.value })} placeholder="Chest pain, shortness of breath..." /></label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button><button className="btn-primary" disabled={busy || !f.chief_complaint} onClick={register}>{busy && <Spinner />} Register</button></div>
        </div>
      </Modal>

      <Modal open={modal === 'triage'} onClose={() => setModal('')} title={`Triage: ${fullName(sel?.patients)}`} wide>
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <div className="grid gap-2 sm:grid-cols-5">
            {ESI.map((e) => (
              <button key={e.level} type="button" onClick={() => setF({ ...f, triage_level: e.level })}
                className={cn('rounded-xl p-3 text-left ring-2 transition', Number(f.triage_level) === e.level ? `${e.cls} ring-transparent` : 'bg-white ring-slate-200')}>
                <p className="text-lg font-extrabold">ESI {e.level}</p><p className="text-xs font-semibold">{e.label}</p><p className="mt-1 text-[11px] opacity-80">{e.desc}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['bp', 'BP'], ['pulse', 'Pulse'], ['resp', 'Resp rate'], ['temp', 'Temp (°F)'], ['spo2', 'SpO2 %'], ['pain_score', 'Pain (0-10)'], ['area', 'Area / bay']].map(([k, l]) => (
              <label key={k} className="block"><span className="label">{l}</span><input className="input" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
            ))}
          </div>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button><button className="btn-primary" disabled={busy} onClick={triage}>{busy && <Spinner />} Save triage</button></div>
        </div>
      </Modal>

      <Modal open={modal === 'treat'} onClose={() => setModal('')} title="Assign doctor & area">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <label className="block"><span className="label">Doctor</span><select className="input" value={f.doctor_id} onChange={(e) => setF({ ...f, doctor_id: e.target.value })}><option value="">Select...</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
          <label className="block"><span className="label">Area / bay</span><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Bay 3" /></label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button><button className="btn-primary" disabled={busy} onClick={treat}>{busy && <Spinner />} Save</button></div>
        </div>
      </Modal>

      <Modal open={modal === 'dispo'} onClose={() => setModal('')} title="Disposition">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <div className="grid grid-cols-2 gap-2">
            {[['discharged', 'Discharge home'], ['admitted', 'Admit to ward'], ['transferred', 'Transfer out'], ['left', 'Left without being seen']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setF({ ...f, status: v })} className={cn('rounded-xl py-2.5 text-sm font-semibold ring-1', f.status === v ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-200')}>{l}</button>
            ))}
          </div>
          <textarea className="input min-h-[100px]" placeholder="Diagnosis, treatment given, instructions..." value={f.disposition_notes} onChange={(e) => setF({ ...f, disposition_notes: e.target.value })} />
          {f.status === 'admitted' && <p className="text-xs text-ink-muted">You will be taken to the bed board to choose a bed.</p>}
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button><button className="btn-primary" disabled={busy} onClick={dispo}>{busy && <Spinner />} Confirm</button></div>
        </div>
      </Modal>
    </div>
  );
}
