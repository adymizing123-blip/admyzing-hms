'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, ChevronLeft, ChevronRight, Video, Plane } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, StatusBadge, Empty, Spinner } from '@/components/ui';
import NewAppointment from '@/components/admin/NewAppointment';
import { useBranch } from '@/components/admin/branch';
import { fmtTime, fullName, todayISO, titleCase } from '@/lib/utils';

function Appointments() {
  const supabase = createClient();
  const params = useSearchParams();
  const { branchId, branches } = useBranch();
  const [clinicId, setClinicId] = useState(branchId || '');
  const [date, setDate] = useState(todayISO());
  const [doctorId, setDoctorId] = useState('');
  const [status, setStatus] = useState('');
  const [doctors, setDoctors] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(!!params.get('patient'));
  const [onLeave, setOnLeave] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('doctor_leaves').select('*, doctors(full_name)').lte('start_date', date).gte('end_date', date).then(({ data }) => setOnLeave(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    supabase.from('doctors').select('id, full_name').order('full_name').then(({ data }) => setDoctors(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    let q = supabase.from('appointments').select('*, patients(id, first_name, last_name, mrn, phone), doctors(full_name), branches(name)')
      .gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString()).order('scheduled_at');
    if (doctorId) q = q.eq('doctor_id', doctorId);
    if (clinicId) q = q.eq('branch_id', clinicId);
    if (status) q = q.eq('status', status);
    const { data } = await q;
    setRows(data || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, doctorId, status, clinicId]);

  useEffect(() => { load(); }, [load]);

  const shift = (n: number) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); setDate(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)); };
  const setStatusFor = async (id: string, s: string) => { await supabase.from('appointments').update({ status: s }).eq('id', id); load(); };

  return (
    <div>
      <PageHeader title="Appointments" subtitle="Schedule, check in and manage visits." actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> New appointment</button>} />
      <div className="card mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="flex items-center gap-1">
          <button className="btn-secondary btn-sm" onClick={() => shift(-1)} aria-label="Previous day"><ChevronLeft size={14} /></button>
          <input type="date" className="input py-2" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn-secondary btn-sm" onClick={() => shift(1)} aria-label="Next day"><ChevronRight size={14} /></button>
        </div>
        <select className="input py-2 sm:max-w-[220px]" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">All doctors</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <select className="input py-2 sm:max-w-[200px]" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
          <option value="">All clinics</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input py-2 sm:max-w-[180px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
        <span className="text-sm text-ink-muted sm:ml-auto">{rows.length} appointment(s)</span>
      </div>

      {onLeave.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Plane size={16} className="mt-0.5 shrink-0" /> On leave this day: {onLeave.map((l) => `${l.doctors?.full_name}${l.reason ? ` (${l.reason})` : ''}`).join(', ')}
        </div>
      )}
      <div className="card divide-y divide-slate-100">
        {loading ? <div className="flex justify-center py-10"><Spinner /></div> : rows.length === 0 ? <Empty text="No appointments for this day." /> : rows.map((a) => (
          <div key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-16 shrink-0 text-center">
                <p className="text-sm font-bold">{fmtTime(a.scheduled_at)}</p>
                <p className="text-[11px] text-ink-muted">Token #{a.token_no}</p>
              </div>
              <div className="min-w-0">
                <Link href={`/admin/patients/${a.patients?.id}`} className="font-semibold hover:text-brand-700">{fullName(a.patients)}</Link>
                <p className="text-xs text-ink-soft">{a.patients?.mrn} · {a.branches?.name ? `${a.branches.name} · ` : ''}{a.doctors?.full_name} · {titleCase(a.source)}{a.visit_type === 'video' && <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700"><Video size={11} /> Video</span>}</p>
                {a.reason && <p className="text-xs text-ink-muted">{a.reason}</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={a.status} />
              {a.visit_type === 'video' && a.video_url && ['booked', 'checked_in', 'in_consultation'].includes(a.status) && <a href={a.video_url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm"><Video size={13} /> Join</a>}
              {a.status === 'booked' && <button className="btn-primary btn-sm" onClick={() => setStatusFor(a.id, 'checked_in')}>Check in</button>}
              {['booked', 'checked_in'].includes(a.status) && <Link href={`/admin/opd/${a.id}`} className="btn-secondary btn-sm">Consult</Link>}
              {a.status === 'booked' && <button className="btn-ghost btn-sm" onClick={() => setStatusFor(a.id, 'no_show')}>No-show</button>}
              {['booked', 'checked_in'].includes(a.status) && <button className="btn-ghost btn-sm text-rose-600" onClick={() => setStatusFor(a.id, 'cancelled')}>Cancel</button>}
            </div>
          </div>
        ))}
      </div>

      <NewAppointment open={open} onClose={() => setOpen(false)} onSaved={load} presetPatientId={params.get('patient') || undefined} />
    </div>
  );
}

export default function Page() { return <Suspense><Appointments /></Suspense>; }
