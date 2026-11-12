'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { UserPlus, Video } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, StatusBadge, Empty } from '@/components/ui';
import NewAppointment from '@/components/admin/NewAppointment';
import { useBranch } from '@/components/admin/branch';
import { cn, fmtTime, fullName } from '@/lib/utils';

export default function OPDQueue() {
  const supabase = createClient();
  const { branchId, branches } = useBranch();
  const [clinicId, setClinicId] = useState(branchId || '');
  const [doctors, setDoctors] = useState<any[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: docs } = await supabase.from('doctors').select('id, full_name, profile_id').eq('active', true).match(branchId ? { branch_id: branchId } : {}).order('full_name');
      setDoctors(docs || []);
      const { data: { user } } = await supabase.auth.getUser();
      const mine = docs?.find((d) => d.profile_id === user?.id);
      if (mine) setDoctorId(mine.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    let q = supabase.from('appointments').select('*, patients(id, first_name, last_name, mrn, dob, gender, allergies), doctors(full_name), branches(name)')
      .gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString())
      .not('status', 'in', '(cancelled,no_show)').order('token_no');
    if (doctorId) q = q.eq('doctor_id', doctorId);
    if (clinicId) q = q.eq('branch_id', clinicId);
    const { data } = await q;
    setRows(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, clinicId]);

  useEffect(() => {
    load();
    const ch = supabase.channel('opd-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const setStatus = async (id: string, status: string) => { await supabase.from('appointments').update({ status }).eq('id', id); load(); };

  const cols = [
    { id: 'booked', title: 'Booked', tone: 'border-sky-200' },
    { id: 'checked_in', title: 'Waiting', tone: 'border-amber-300' },
    { id: 'in_consultation', title: 'With doctor', tone: 'border-violet-300' },
    { id: 'completed', title: 'Done', tone: 'border-emerald-300' },
  ];

  return (
    <div>
      <PageHeader title="OPD Queue" subtitle="Live outpatient queue for today. Updates automatically."
        actions={<button className="btn-primary" onClick={() => setOpen(true)}><UserPlus size={16} /> Walk-in</button>} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <select className="input sm:max-w-xs" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">All doctors</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <select className="input sm:max-w-xs" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
          <option value="">All clinics</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cols.map((c) => {
          const list = rows.filter((r) => r.status === c.id);
          return (
            <div key={c.id} className={cn('rounded-2xl border-t-4 bg-white/60 p-3', c.tone)}>
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-bold">{c.title}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold">{list.length}</span>
              </div>
              <div className="space-y-2">
                {list.length === 0 && <Empty text="Empty" />}
                {list.map((a) => (
                  <div key={a.id} className="card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{fullName(a.patients)}</p>
                        <p className="text-xs text-ink-soft">{a.patients?.mrn} · {fmtTime(a.scheduled_at)}</p>
                        <p className="text-xs text-ink-muted">{a.branches?.name}{!doctorId && ` · ${a.doctors?.full_name}`}</p>
                      </div>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-extrabold text-brand-700">{a.token_no}</span>
                    </div>
                    {a.visit_type === 'video' && <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700"><Video size={11} /> Video visit</p>}
                    {a.patients?.allergies && <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">Allergy: {a.patients.allergies}</p>}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {a.status === 'booked' && <button className="btn-primary btn-sm" onClick={() => setStatus(a.id, 'checked_in')}>Check in</button>}
                      {['checked_in', 'in_consultation'].includes(a.status) && <Link href={`/admin/opd/${a.id}`} className="btn-primary btn-sm">{a.status === 'checked_in' ? 'Start consult' : 'Continue'}</Link>}
                      {a.status === 'completed' && <StatusBadge status="completed" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <NewAppointment open={open} walkIn onClose={() => setOpen(false)} onSaved={load} />
    </div>
  );
}
