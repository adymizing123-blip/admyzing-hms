'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Modal, PageHeader, Alert, Spinner, StatusBadge, Empty } from '@/components/ui';
import PatientPicker, { type PickedPatient } from '@/components/admin/PatientPicker';
import { StatCard } from '@/components/ui/StatCard';
import { cn, fmtDate, fullName, money, todayISO } from '@/lib/utils';
import { Tabs } from '@/components/ui';
import { useBranch } from '@/components/admin/branch';

const bedTone: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100',
  occupied: 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100',
  cleaning: 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100',
  maintenance: 'bg-slate-100 text-slate-500 ring-slate-200',
  reserved: 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100',
};

function IPD() {
  const supabase = createClient();
  const { branchId } = useBranch();
  const params = useSearchParams();
  const [wards, setWards] = useState<any[]>([]);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [bed, setBed] = useState<any>(null);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [f, setF] = useState({ doctor_id: '', reason: '', from: todayISO(), to: todayISO() });
  const [mode, setMode] = useState('admit');
  const [reservations, setReservations] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [{ data: w }, { data: a }, { data: r }] = await Promise.all([
      (branchId ? supabase.from('wards').select('*, beds(*)').eq('branch_id', branchId) : supabase.from('wards').select('*, beds(*)')).order('name'),
      supabase.from('admissions').select('*, patients(first_name,last_name,mrn), doctors(full_name), beds(bed_no, wards(name))').eq('status', 'admitted').order('admitted_at', { ascending: false }),
      supabase.from('bed_reservations').select('*, patients(first_name,last_name,mrn), doctors(full_name), beds(bed_no, wards(name))').eq('status', 'reserved').gte('reserved_to', todayISO()).order('reserved_from'),
    ]);
    setReservations(r || []);
    setWards((w || []).map((x: any) => ({ ...x, beds: x.beds.sort((p: any, q: any) => p.bed_no.localeCompare(q.bed_no)) })));
    setAdmissions(a || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from('doctors').select('id, full_name').eq('active', true).order('full_name').then(({ data }) => setDoctors(data || []));
    const pid = params.get('admit');
    if (pid) supabase.from('patients').select('id, first_name, last_name, mrn, phone').eq('id', pid).single().then(({ data }) => data && setPatient(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byBed = Object.fromEntries(admissions.map((a) => [a.bed_id, a]));
  const today = todayISO();
  const d10 = (x: string) => String(x).slice(0, 10);
  const resToday = Object.fromEntries(reservations.filter((r) => d10(r.reserved_from) <= today && d10(r.reserved_to) >= today).map((r) => [r.bed_id, r]));

  const admitReservation = async (r: any) => {
    if (!confirm(`Admit ${fullName(r.patients)} to ${r.beds?.bed_no} now?`)) return;
    const { error } = await supabase.rpc('admit_reservation', { p_reservation: r.id });
    if (error) return alert(error.message);
    load();
  };
  const cancelReservation = async (r: any) => {
    if (!confirm('Cancel this reservation?')) return;
    await supabase.from('bed_reservations').update({ status: 'cancelled' }).eq('id', r.id);
    load();
  };
  const allBeds = wards.flatMap((w) => w.beds);

  const clickBed = async (b: any) => {
    if (b.status === 'available' && resToday[b.id]) return admitReservation(resToday[b.id]);
    if (b.status === 'available') { setBed(b); setErr(''); setMode('admit'); return; }
    if (b.status === 'cleaning' && confirm(`Mark ${b.bed_no} as clean and available?`)) {
      await supabase.from('beds').update({ status: 'available' }).eq('id', b.id); load();
    }
  };

  const admit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient) return setErr('Select a patient');
    setBusy(true);
    const { error } = mode === 'admit'
      ? await supabase.rpc('admit_patient', { p_patient: patient.id, p_doctor: f.doctor_id || null, p_bed: bed.id, p_reason: f.reason })
      : await supabase.rpc('reserve_bed', { p_bed: bed.id, p_patient: patient.id, p_doctor: f.doctor_id || null, p_from: f.from, p_to: f.to, p_reason: f.reason });
    setBusy(false);
    if (error) return setErr(error.message);
    setBed(null); setPatient(null); setF({ doctor_id: '', reason: '', from: todayISO(), to: todayISO() });
    load();
  };

  return (
    <div>
      <PageHeader title="IPD & Bed Management" subtitle="Tap a green bed to admit or reserve it. Violet beds are reserved for today: tap to admit that patient. Tap an amber bed once it has been cleaned." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total beds" value={allBeds.length} />
        <StatCard label="Available" value={allBeds.filter((b) => b.status === 'available').length} tone="brand" />
        <StatCard label="Occupied" value={allBeds.filter((b) => b.status === 'occupied').length} tone="rose" />
        <StatCard label="Cleaning" value={allBeds.filter((b) => b.status === 'cleaning').length} tone="amber" hint={`${reservations.length} upcoming reservation(s)`} />
      </div>

      <div className="space-y-5">
        {wards.map((w) => (
          <div key={w.id} className="card p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{w.name} <span className="text-sm font-normal text-ink-muted">· {money(w.daily_rate)}/day</span></h2>
              <span className="text-xs text-ink-muted">{w.beds.filter((b: any) => b.status === 'available').length} free of {w.beds.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {w.beds.map((b: any) => {
                const a = byBed[b.id];
                const res = !a && b.status === 'available' ? resToday[b.id] : null;
                const tone = res ? 'reserved' : b.status;
                const content = (
                  <>
                    <p className="text-xs font-bold">{b.bed_no}</p>
                    <p className="mt-0.5 truncate text-[11px]">{a ? fullName(a.patients) : res ? `Reserved: ${res.patients?.first_name}` : b.status}</p>
                  </>
                );
                return a ? (
                  <Link key={b.id} href={`/admin/ipd/${a.id}`} className={cn('rounded-xl p-2.5 text-left ring-1 transition', bedTone[b.status])}>{content}</Link>
                ) : (
                  <button key={b.id} onClick={() => clickBed(b)} className={cn('rounded-xl p-2.5 text-left ring-1 transition', !res && 'capitalize', bedTone[tone])}>{content}</button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 font-bold">Upcoming reservations</h2>
      <div className="card divide-y divide-slate-100">
        {reservations.length === 0 && <Empty text="No upcoming reservations." />}
        {reservations.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{fullName(r.patients)} <span className="text-xs font-normal text-ink-muted">{r.patients?.mrn}</span></p>
              <p className="text-xs text-ink-soft">{r.beds?.wards?.name} · {r.beds?.bed_no} · {fmtDate(r.reserved_from)} to {fmtDate(r.reserved_to)}{r.doctors ? ` · ${r.doctors.full_name}` : ''}{r.reason ? ` · ${r.reason}` : ''}</p>
            </div>
            <div className="flex gap-2">
              {d10(r.reserved_from) <= today && <button className="btn-primary btn-sm" onClick={() => admitReservation(r)}>Admit now</button>}
              <button className="btn-ghost btn-sm text-rose-600" onClick={() => cancelReservation(r)}>Cancel</button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 font-bold">Current admissions</h2>
      <div className="card divide-y divide-slate-100">
        {admissions.length === 0 && <Empty text="No patients admitted." />}
        {admissions.map((a) => (
          <Link key={a.id} href={`/admin/ipd/${a.id}`} className="flex flex-col gap-1 px-5 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{fullName(a.patients)} <span className="text-xs font-normal text-ink-muted">{a.patients?.mrn}</span></p>
              <p className="text-xs text-ink-soft">{a.beds?.wards?.name} · {a.beds?.bed_no} · {a.doctors?.full_name || 'No doctor'} · since {fmtDate(a.admitted_at)}</p>
            </div>
            <StatusBadge status={a.status} />
          </Link>
        ))}
      </div>

      <Modal open={!!bed} onClose={() => setBed(null)} title={`Bed ${bed?.bed_no || ''}`}>
        <form onSubmit={admit} className="space-y-4">
          <Tabs value={mode} onChange={setMode} tabs={[{ id: 'admit', label: 'Admit now' }, { id: 'reserve', label: 'Reserve for later' }]} />
          {err && <Alert>{err}</Alert>}
          <div><span className="label">Patient</span><PatientPicker value={patient} onChange={setPatient} /></div>
          <label className="block"><span className="label">Attending doctor</span>
            <select className="input" value={f.doctor_id} onChange={(e) => setF({ ...f, doctor_id: e.target.value })}>
              <option value="">Select...</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select></label>
          {mode === 'reserve' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">From</span><input type="date" className="input" min={todayISO()} required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></label>
              <label className="block"><span className="label">To</span><input type="date" className="input" min={f.from} required value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            </div>
          )}
          <label className="block"><span className="label">{mode === 'admit' ? 'Reason for admission' : 'Reason (e.g. planned surgery)'}</span><textarea className="input" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setBed(null)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} {mode === 'admit' ? 'Admit patient' : 'Reserve bed'}</button></div>
        </form>
      </Modal>
    </div>
  );
}

export default function Page() { return <Suspense><IPD /></Suspense>; }
