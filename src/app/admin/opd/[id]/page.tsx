'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Trash2, Printer, CheckCircle2, Video, MessageCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';
import { age, cn, fmtDate, fullName, money } from '@/lib/utils';
import { RxPadPrintable, type PadData } from '@/components/admin/RxPad';
import { clinicInfo, mergePad, rxMessage, type PadConfig } from '@/lib/rx-pad';
import SendMessage from '@/components/admin/SendMessage';

const blankRx = { medicine_id: '', medicine_name: '', dosage: '', frequency: '', duration: '', instructions: '' };

export default function Consultation() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [appt, setAppt] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [meds, setMeds] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [vitals, setVitals] = useState<any>({ bp: '', pulse: '', temp: '', spo2: '', weight: '', height: '' });
  const [f, setF] = useState({ complaints: '', diagnosis: '', icd10_codes: '', notes: '', advice: '', follow_up_date: '' });
  const [pad, setPad] = useState<PadConfig>(mergePad());
  const [clinic, setClinic] = useState<{ name: string; address?: string | null; phone?: string | null; timings?: string }>({ name: 'CarePlus Hospital' });
  const [rx, setRx] = useState<any[]>([{ ...blankRx }]);
  const [labIds, setLabIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<any>(null);
  const [waOpen, setWaOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from('appointments').select('*, patients(*), doctors(*)').eq('id', id).single();
      setAppt(a);
      if (a?.status === 'checked_in' || a?.status === 'booked') await supabase.from('appointments').update({ status: 'in_consultation' }).eq('id', id);
      const [{ data: h }, { data: m }, { data: t }] = await Promise.all([
        supabase.from('visits').select('*, prescriptions(*), doctors(full_name)').eq('patient_id', a.patient_id).order('created_at', { ascending: false }).limit(5),
        supabase.from('medicines').select('id, name, strength, form').eq('active', true).order('name'),
        supabase.from('lab_tests').select('id, name, price, category').eq('active', true).order('name'),
      ]);
      setHistory(h || []); setMeds(m || []); setTests(t || []);

      // prescription pad: this doctor's design + the clinic this appointment is at
      const [{ data: ps }, { data: br }] = await Promise.all([
        supabase.from('rx_pad_settings').select('config').eq('doctor_id', a.doctor_id).maybeSingle(),
        a.branch_id ? supabase.from('branches').select('name, address, phone, timings').eq('id', a.branch_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const base = mergePad(ps?.config);
      setPad({ ...base, qualifications: base.qualifications || a.doctors?.qualification || '', speciality: base.speciality || a.doctors?.specialty || '' });
      if (br) setClinic(clinicInfo(br));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const { data: visit, error } = await supabase.from('visits').insert({
        appointment_id: appt.id, patient_id: appt.patient_id, doctor_id: appt.doctor_id,
        vitals: Object.fromEntries(Object.entries(vitals).filter(([, v]) => v)),
        complaints: f.complaints || null, diagnosis: f.diagnosis || null, icd10_codes: f.icd10_codes || null, notes: f.notes || null, advice: f.advice || null, follow_up_date: f.follow_up_date || null,
        branch_id: appt.branch_id || null,
      }).select().single();
      if (error) throw error;

      const items = rx.filter((r) => r.medicine_name.trim());
      if (items.length) {
        const { error: e2 } = await supabase.from('prescriptions').insert(items.map((r) => ({ ...r, medicine_id: r.medicine_id || null, visit_id: visit.id })));
        if (e2) throw e2;
      }

      if (labIds.length) {
        const { data: lo, error: e3 } = await supabase.from('lab_orders').insert({ patient_id: appt.patient_id, doctor_id: appt.doctor_id, visit_id: visit.id }).select().single();
        if (e3) throw e3;
        await supabase.from('lab_order_items').insert(labIds.map((tid) => ({ lab_order_id: lo.id, lab_test_id: tid, price: tests.find((t) => t.id === tid)?.price || 0 })));
      }

      // consultation bill (description includes doctor name for commission tracking)
      const { data: inv } = await supabase.from('invoices').insert({ patient_id: appt.patient_id, notes: 'OPD consultation' }).select().single();
      if (inv) {
        await supabase.from('invoice_items').insert({ invoice_id: inv.id, category: 'consultation', description: `Consultation: ${appt.doctors.full_name}${appt.visit_type === 'video' ? ' (video)' : ''}`, quantity: 1, unit_price: appt.doctors.consultation_fee, code: '99213' });
      }
      if (f.follow_up_date) {
        await supabase.from('follow_ups').insert({ patient_id: appt.patient_id, due_date: f.follow_up_date, channel: 'call', message: `Follow-up with ${appt.doctors.full_name}` });
      }
      await supabase.from('appointments').update({ status: 'completed' }).eq('id', appt.id);
      setDone({ visit, invoice: inv, rx: items });
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  };

  if (!appt) return <div className="flex justify-center py-20"><Spinner /></div>;
  const p = appt.patients;

  // everything the doctor types lands on the pad as they write
  const padData: PadData = {
    doctorName: appt.doctors.full_name,
    clinic,
    patient: { name: fullName(p), mrn: p.mrn, age: age(p.dob) ? String(age(p.dob)) : '', sex: p.gender || '', date: fmtDate(new Date()) },
    vitals: Object.fromEntries(Object.entries(vitals).filter(([, v]) => v).map(([k, v]) => [k, String(v)])),
    complaints: f.complaints, diagnosis: f.diagnosis,
    items: rx.filter((r) => r.medicine_name.trim()),
    tests: tests.filter((t) => labIds.includes(t.id)).map((t) => t.name),
    advice: f.advice,
    followUp: f.follow_up_date ? fmtDate(f.follow_up_date) : '',
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="no-print card mb-4 p-6 text-center">
          <CheckCircle2 className="mx-auto text-brand-600" size={44} />
          <h1 className="mt-3 text-xl font-bold">Consultation saved</h1>
          <p className="text-sm text-ink-soft">A consultation bill of {money(appt.doctors.consultation_fee)} was created.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print prescription</button>
            <button className="btn-secondary" onClick={() => setWaOpen(true)}><MessageCircle size={16} /> Send on WhatsApp</button>
            {done.invoice && <Link href={`/admin/billing/${done.invoice.id}`} className="btn-secondary">Open bill</Link>}
            <Link href="/admin/opd" className="btn-secondary">Back to queue</Link>
          </div>
        </div>
        <RxPadPrintable cfg={pad} data={padData} />
        <SendMessage open={waOpen} onClose={() => setWaOpen(false)} defaultChannel="whatsapp" purpose="prescription" defaultBody={rxMessage(padData)}
          to={{ name: fullName(p), phone: p.phone, email: p.email, patient_id: p.id }} />
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">{fullName(p)}</h1>
              <p className="text-sm text-ink-soft">{p.mrn} · {age(p.dob)} · {p.gender || '-'} · Blood {p.blood_group || '-'} · Token #{appt.token_no}</p>
            </div>
            <div className="flex gap-2">
              {appt.visit_type === 'video' && appt.video_url && <a href={appt.video_url} target="_blank" rel="noreferrer" className="btn-primary btn-sm"><Video size={14} /> Start video call</a>}
              <Link href={`/admin/referrals?new=${p.id}`} className="btn-secondary btn-sm">Refer</Link>
              <Link href={`/admin/patients/${p.id}`} className="btn-secondary btn-sm">Full record</Link>
            </div>
          </div>
          {p.allergies && <div className="mt-3"><Alert>Allergies: {p.allergies}</Alert></div>}
          {appt.reason && <p className="mt-3 text-sm"><span className="font-semibold">Reason:</span> {appt.reason}</p>}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 font-bold">Vitals</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[['bp', 'BP (mmHg)', '120/80'], ['pulse', 'Pulse (bpm)', '72'], ['temp', 'Temp (°F)', '98.6'], ['spo2', 'SpO2 (%)', '98'], ['weight', 'Weight (lb)', ''], ['height', 'Height (in)', '']].map(([k, l, ph]) => (
              <label key={k} className="block"><span className="label">{l}</span><input className="input" placeholder={ph} value={vitals[k]} onChange={(e) => setVitals({ ...vitals, [k]: e.target.value })} /></label>
            ))}
          </div>
        </div>

        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="label">Chief complaints</span><textarea className="input" value={f.complaints} onChange={(e) => setF({ ...f, complaints: e.target.value })} /></label>
          <label className="block"><span className="label">Diagnosis</span><input className="input" value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></label>
          <label className="block"><span className="label">ICD-10 codes (for insurance)</span><input className="input" placeholder="e.g. J06.9, R50.9" value={f.icd10_codes} onChange={(e) => setF({ ...f, icd10_codes: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">Clinical notes</span><textarea className="input min-h-[100px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">Advice for the patient (printed on the prescription)</span><textarea className="input" placeholder="Rest, plenty of fluids, avoid cold drinks..." value={f.advice} onChange={(e) => setF({ ...f, advice: e.target.value })} /></label>
          <label className="block"><span className="label">Follow-up date</span><input type="date" className="input" value={f.follow_up_date} onChange={(e) => setF({ ...f, follow_up_date: e.target.value })} /></label>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold">Prescription</h2>
            <button className="btn-secondary btn-sm" onClick={() => setRx([...rx, { ...blankRx }])}><Plus size={14} /> Add medicine</button>
          </div>
          <datalist id="meds">{meds.map((m) => <option key={m.id} value={`${m.name} ${m.strength || ''}`.trim()} />)}</datalist>
          <div className="space-y-3">
            {rx.map((r, i) => (
              <div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-12">
                <input list="meds" className="input sm:col-span-4" placeholder="Medicine" value={r.medicine_name}
                  onChange={(e) => {
                    const m = meds.find((x) => `${x.name} ${x.strength || ''}`.trim() === e.target.value);
                    const n = [...rx]; n[i] = { ...r, medicine_name: e.target.value, medicine_id: m?.id || '' }; setRx(n);
                  }} />
                <input className="input sm:col-span-2" placeholder="Dose (1 tab)" value={r.dosage} onChange={(e) => { const n = [...rx]; n[i] = { ...r, dosage: e.target.value }; setRx(n); }} />
                <input className="input sm:col-span-2" placeholder="Twice daily" value={r.frequency} onChange={(e) => { const n = [...rx]; n[i] = { ...r, frequency: e.target.value }; setRx(n); }} />
                <input className="input sm:col-span-2" placeholder="5 days" value={r.duration} onChange={(e) => { const n = [...rx]; n[i] = { ...r, duration: e.target.value }; setRx(n); }} />
                <div className="flex gap-2 sm:col-span-2">
                  <input className="input" placeholder="After food" value={r.instructions} onChange={(e) => { const n = [...rx]; n[i] = { ...r, instructions: e.target.value }; setRx(n); }} />
                  <button className="btn-ghost px-2 text-rose-600" onClick={() => setRx(rx.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 font-bold">Order lab tests</h2>
          <div className="flex flex-wrap gap-2">
            {tests.map((t) => {
              const on = labIds.includes(t.id);
              return (
                <button key={t.id} onClick={() => setLabIds(on ? labIds.filter((x) => x !== t.id) : [...labIds, t.id])}
                  className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold ring-1', on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200')}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>

        {err && <Alert>{err}</Alert>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn-secondary" onClick={() => router.push('/admin/opd')}>Save later</button>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />} Complete consultation</button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Prescription pad</h2>
            <span className="text-xs text-ink-muted">{clinic.name} · live</span>
          </div>
          <RxPadPrintable cfg={pad} data={padData} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => window.print()}><Printer size={14} /> Print pad</button>
            <button className="btn-secondary btn-sm" onClick={() => setWaOpen(true)}><MessageCircle size={14} /> WhatsApp</button>
            <Link href="/admin/rx-pad" className="btn-ghost btn-sm">Change design</Link>
          </div>
          <SendMessage open={waOpen} onClose={() => setWaOpen(false)} defaultChannel="whatsapp" purpose="prescription" defaultBody={rxMessage(padData)}
            to={{ name: fullName(p), phone: p.phone, email: p.email, patient_id: p.id }} />
        </div>
        <h2 className="font-bold">Previous visits</h2>
        {history.length === 0 && <div className="card p-5 text-sm text-ink-muted">First visit.</div>}
        {history.map((v) => (
          <div key={v.id} className="card p-4 text-sm">
            <p className="font-semibold">{fmtDate(v.created_at)} · {v.doctors?.full_name}</p>
            {v.diagnosis && <p className="mt-1">{v.diagnosis}</p>}
            {v.prescriptions?.length > 0 && <p className="mt-1 text-xs text-ink-soft">{v.prescriptions.map((x: any) => x.medicine_name).join(', ')}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
