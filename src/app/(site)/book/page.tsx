'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Video, Building2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';
import { cn, money, fmtDateTime } from '@/lib/utils';
import { useT } from '@/components/site/lang';
import { visitSource } from '@/lib/visit-source';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localISODate(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Booking() {
  const supabase = createClient();
  const t = useT();
  const params = useSearchParams();
  const [step, setStep] = useState(1);
  const [depts, setDepts] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [deptId, setDeptId] = useState('');
  const [doctor, setDoctor] = useState<any>(null);
  const [date, setDate] = useState('');
  const [taken, setTaken] = useState<number[]>([]);
  const [slot, setSlot] = useState<Date | null>(null);
  const [visitType, setVisitType] = useState<'in_person' | 'video'>('in_person');
  const [leave, setLeave] = useState<string[]>([]);
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '', dob: '', reason: '' });
  const [loggedIn, setLoggedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const [{ data: d }, { data: docs }] = await Promise.all([
        supabase.from('departments').select('id, name').order('name'),
        supabase.from('doctors').select('*, departments(name)').eq('active', true).order('full_name'),
      ]);
      setDepts(d || []);
      setDoctors(docs || []);
      const pre = params.get('doctor');
      if (pre) {
        const doc = docs?.find((x) => x.id === pre);
        if (doc) { setDoctor(doc); setStep(2); }
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('patients').select('*').eq('profile_id', user.id).maybeSingle();
        if (p) {
          setLoggedIn(true);
          setForm((f) => ({ ...f, first_name: p.first_name, last_name: p.last_name === '-' ? '' : p.last_name, phone: p.phone || '', email: p.email || '', dob: p.dob || '' }));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!doctor) return;
    const from = localISODate(new Date());
    const to = localISODate(new Date(Date.now() + 30 * 864e5));
    supabase.rpc('doctor_leave_dates', { p_doctor: doctor.id, p_from: from, p_to: to })
      .then(({ data }) => setLeave((data || []).map((d: any) => (typeof d === 'string' ? d : d.doctor_leave_dates))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor]);

  const dates = useMemo(() => {
    if (!doctor) return [];
    const out: Date[] = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 21 && out.length < 14; i++) {
      const x = new Date(d);
      x.setDate(d.getDate() + i);
      if ((doctor.available_days || []).includes(x.getDay()) && !leave.includes(localISODate(x))) out.push(x);
    }
    return out;
  }, [doctor, leave]);

  useEffect(() => {
    if (!doctor || !date) return;
    setSlot(null);
    supabase.rpc('booked_slots', { p_doctor_id: doctor.id, p_date: date }).then(({ data }) => {
      setTaken((data || []).map((t: any) => new Date(typeof t === 'string' ? t : t.booked_slots).getTime()));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctor, date]);

  const slots = useMemo(() => {
    if (!doctor || !date) return [];
    const [sh, sm] = String(doctor.start_time).split(':').map(Number);
    const [eh, em] = String(doctor.end_time).split(':').map(Number);
    const base = new Date(`${date}T00:00:00`);
    const out: Date[] = [];
    for (let m = sh * 60 + sm; m + doctor.slot_minutes <= eh * 60 + em; m += doctor.slot_minutes) {
      const s = new Date(base);
      s.setMinutes(m);
      if (s.getTime() > Date.now() + 15 * 60000) out.push(s);
    }
    return out;
  }, [doctor, date]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { data, error: err } = await supabase.rpc('book_appointment', {
      p_doctor_id: doctor.id,
      p_scheduled_at: slot!.toISOString(),
      p_first_name: form.first_name,
      p_last_name: form.last_name,
      p_phone: form.phone,
      p_email: form.email,
      p_dob: form.dob || null,
      p_reason: form.reason || null,
      p_visit_type: visitType,
      p_source: visitSource()?.source || null,
    });
    setBusy(false);
    if (err) return setError(err.message);
    fetch('/api/automations/kick', { method: 'POST' }).catch(() => {});
    setResult(data);
    setStep(4);
  };

  const shownDoctors = deptId ? doctors.filter((d) => d.department_id === deptId) : doctors;

  return (
    <div className="container-x max-w-4xl py-10 sm:py-14">
      <h1 className="text-3xl font-extrabold tracking-tight">{t('Book an appointment')}</h1>
      <div className="mt-6 flex gap-2">
        {['Doctor', 'Date & time', 'Your details', 'Confirmed'].map((l, i) => (
          <div key={l} className="flex-1">
            <div className={cn('h-1.5 rounded-full', step > i ? 'bg-brand-600' : 'bg-slate-200')} />
            <p className={cn('mt-2 hidden text-xs font-semibold sm:block', step > i ? 'text-brand-700' : 'text-ink-muted')}>{t(l)}</p>
          </div>
        ))}
      </div>

      {step > 1 && step < 4 && (
        <button className="btn-ghost mt-6 -ml-3" onClick={() => setStep(step - 1)}><ChevronLeft size={16} /> {t('Back')}</button>
      )}

      {step === 1 && (
        <div className="mt-8">
          <select className="input sm:max-w-xs" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="">{t('All departments')}</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {shownDoctors.map((d) => (
              <button key={d.id} onClick={() => { setDoctor(d); setDate(''); setStep(2); }}
                className="card flex items-center gap-4 p-4 text-left transition hover:border-brand-300">
                {d.photo_url ? <img src={d.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-xl bg-brand-50 object-cover" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-brand-50 text-xl font-bold text-brand-600">{d.full_name.replace('Dr. ', '')[0]}</span>}
                <div className="min-w-0">
                  <p className="font-bold">{d.full_name}</p>
                  <p className="truncate text-sm text-ink-soft">{d.departments?.name} · {d.specialty}</p>
                  <p className="mt-1 text-sm font-semibold text-brand-700">{money(d.consultation_fee)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && doctor && (
        <div className="mt-4 space-y-6">
          <div className="card flex items-center gap-4 p-4">
            {doctor.photo_url ? <img src={doctor.photo_url} alt="" className="h-14 w-14 rounded-xl bg-brand-50 object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-xl bg-brand-50 text-lg font-bold text-brand-600">{doctor.full_name.replace('Dr. ', '')[0]}</span>}
            <div><p className="font-bold">{doctor.full_name}</p><p className="text-sm text-ink-soft">{doctor.specialty} · {money(doctor.consultation_fee)}</p></div>
          </div>
          <div>
            <p className="label">{t('Visit type')}</p>
            <div className="grid grid-cols-2 gap-2 sm:max-w-md">
              {([['in_person', 'At the hospital', Building2], ['video', 'Video visit', Video]] as const).map(([v, l, Icon]) => (
                <button key={v} onClick={() => setVisitType(v)}
                  className={cn('flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold ring-1 transition', visitType === v ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200 hover:ring-brand-300')}>
                  <Icon size={16} /> {t(l)}
                </button>
              ))}
            </div>
            {visitType === 'video' && <p className="mt-2 text-xs text-ink-soft">{t('You will get a secure video link. Join from your phone or computer, no app needed.')}</p>}
          </div>
          <div>
            <p className="label">{t('Choose a date')}</p>
            <div className="-mx-4 overflow-x-auto px-4 pb-1">
              <div className="flex gap-2">
                {dates.map((d) => {
                  const iso = localISODate(d);
                  return (
                    <button key={iso} onClick={() => setDate(iso)}
                      className={cn('w-16 shrink-0 rounded-xl py-3 text-center ring-1 transition', date === iso ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200 hover:ring-brand-300')}>
                      <p className="text-xs font-semibold opacity-80">{DAYS[d.getDay()]}</p>
                      <p className="text-lg font-bold">{d.getDate()}</p>
                      <p className="text-[10px] opacity-70">{d.toLocaleString('en-US', { month: 'short' })}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {date && (
            <div>
              <p className="label">{t('Available times')}</p>
              {slots.length === 0 ? <p className="text-sm text-ink-muted">{t('No slots left on this day.')}</p> : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
                  {slots.map((s) => {
                    const isTaken = taken.includes(s.getTime());
                    const active = slot?.getTime() === s.getTime();
                    return (
                      <button key={s.toISOString()} disabled={isTaken} onClick={() => setSlot(s)}
                        className={cn('rounded-lg py-2 text-sm font-semibold ring-1 transition',
                          isTaken ? 'cursor-not-allowed bg-slate-100 text-ink-muted line-through ring-slate-100'
                            : active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200 hover:ring-brand-300')}>
                        {s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <button className="btn-primary w-full sm:w-auto" disabled={!slot} onClick={() => setStep(3)}>{t('Continue')}</button>
        </div>
      )}

      {step === 3 && (
        <form onSubmit={submit} className="card mt-4 grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
          <div className="rounded-xl bg-brand-50 p-4 text-sm sm:col-span-2">
            <p className="font-semibold">{doctor.full_name}</p>
            <p className="text-ink-soft">{fmtDateTime(slot)} · {visitType === 'video' ? 'Video visit' : 'At the hospital'} · {money(doctor.consultation_fee)}</p>
          </div>
          {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
          <label className="block"><span className="label">{t('First name')}</span><input className="input" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></label>
          <label className="block"><span className="label">{t('Last name')}</span><input className="input" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></label>
          <label className="block"><span className="label">{t('Phone')}</span><input className="input" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(555) 123-4567" /></label>
          <label className="block"><span className="label">{t('Email')}</span><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="block"><span className="label">{t('Date of birth')}</span><input className="input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">{t('Reason for visit')}</span><textarea className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          {!loggedIn && <p className="text-xs text-ink-muted sm:col-span-2">{t('Have an account?')} <Link href="/login?next=/book" className="font-semibold text-brand-700">{t('Sign in')}</Link> {t('to see this visit in your portal.')}</p>}
          <div className="sm:col-span-2"><button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy && <Spinner />} Confirm booking</button></div>
        </form>
      )}

      {step === 4 && result && (
        <div className="card mt-8 p-8 text-center">
          <CheckCircle2 className="mx-auto text-brand-600" size={56} />
          <h2 className="mt-4 text-2xl font-bold">{t('You are booked!')}</h2>
          <p className="mt-2 text-ink-soft">{doctor.full_name} · {fmtDateTime(slot)}</p>
          {result.video_url ? (
            <>
              <a href={result.video_url} target="_blank" rel="noreferrer" className="btn-primary mt-4"><Video size={16} /> {t('Your video visit link')}</a>
              <p className="mt-3 break-all text-xs text-ink-muted">{result.video_url}</p>
              <p className="mt-3 text-sm text-ink-muted">{t('Open the link a few minutes before your time. It is also in your patient portal.')}</p>
            </>
          ) : (
            <>
              <p className="mt-4 inline-block rounded-xl bg-brand-50 px-5 py-3 text-sm">{t('Token number')} <span className="text-xl font-extrabold text-brand-700">#{result.token_no}</span></p>
              <p className="mt-4 text-sm text-ink-muted">{t('Please arrive 10 minutes early and bring your photo ID and insurance card.')}</p>
            </>
          )}
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href="/" className="btn-secondary">{t('Back to home')}</Link>
            <Link href={loggedIn ? '/portal' : '/login'} className="btn-primary">{loggedIn ? 'Go to my portal' : 'Create an account'}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BookPage() {
  return <Suspense><Booking /></Suspense>;
}
