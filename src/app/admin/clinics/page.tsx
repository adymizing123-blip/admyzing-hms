'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Building2, ChevronLeft, ChevronRight, MapPin, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Empty, PageHeader, Spinner, StatusBadge } from '@/components/ui';
import { cn, fmtTime, fullName, todayISO } from '@/lib/utils';

/** Which patients came to which clinic, day by day. */
function Clinics() {
  const supabase = createClient();
  const params = useSearchParams();
  const [date, setDate] = useState(todayISO());
  const [clinicId, setClinicId] = useState(params.get('clinic') || '');
  const [clinics, setClinics] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('branches').select('id, name, address, phone, timings').eq('active', true).order('name').then(({ data }) => setClinics(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const { data } = await supabase.from('appointments')
      .select('id, branch_id, scheduled_at, status, token_no, reason, patients(id, first_name, last_name, mrn, phone), doctors(full_name)')
      .gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString())
      .not('status', 'in', '(cancelled,no_show)').order('scheduled_at');
    setRows(data || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const shift = (n: number) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); setDate(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)); };
  const shown = clinics.filter((c) => !clinicId || c.id === clinicId);

  return (
    <div>
      <PageHeader title="Clinics" subtitle="Which patients came to which clinic." />
      <div className="card mb-5 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="flex items-center gap-1">
          <button className="btn-secondary btn-sm" onClick={() => shift(-1)} aria-label="Previous day"><ChevronLeft size={14} /></button>
          <input type="date" className="input w-auto py-2" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn-secondary btn-sm" onClick={() => shift(1)} aria-label="Next day"><ChevronRight size={14} /></button>
        </div>
        <select className="input py-2 sm:max-w-[240px]" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
          <option value="">All clinics</option>
          {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-sm text-ink-muted sm:ml-auto">{rows.filter((r) => !clinicId || r.branch_id === clinicId).length} patient(s)</span>
      </div>

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {shown.map((c) => {
            const list = rows.filter((r) => r.branch_id === c.id);
            return (
              <div key={c.id} className="card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 font-bold"><Building2 size={17} className="text-brand-600" /> {c.name}</h2>
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold', list.length ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-ink-muted')}>{list.length}</span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs text-ink-soft">
                    {c.address && <p className="flex gap-1.5"><MapPin size={12} className="mt-0.5 shrink-0" /> {c.address}</p>}
                    {c.phone && <p className="flex gap-1.5"><Phone size={12} className="mt-0.5 shrink-0" /> {c.phone}</p>}
                  </div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {list.length === 0 && <li><Empty text="No patients at this clinic." /></li>}
                  {list.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-extrabold text-brand-700">{a.token_no}</span>
                        <div className="min-w-0">
                          <Link href={`/admin/patients/${a.patients?.id}`} className="block truncate text-sm font-semibold hover:text-brand-700">{fullName(a.patients)}</Link>
                          <p className="truncate text-xs text-ink-soft">{a.patients?.mrn} · {fmtTime(a.scheduled_at)} · {a.doctors?.full_name}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={a.status} />
                        {['booked', 'checked_in', 'in_consultation'].includes(a.status) && <Link href={`/admin/opd/${a.id}`} className="btn-secondary btn-sm">Consult</Link>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ClinicsPage() {
  return <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}><Clinics /></Suspense>;
}
