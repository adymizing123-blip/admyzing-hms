'use client';
import { useEffect, useMemo, useState } from 'react';
import { Eraser, Printer, Save, Upload, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Field, PageHeader, Spinner } from '@/components/ui';
import { RxPadPrintable, type PadData, type PadEdit } from '@/components/admin/RxPad';
import { PAD_COLORS, clinicInfo, mergePad, type PadConfig, type PadDesign } from '@/lib/rx-pad';
import { cn, fmtDate } from '@/lib/utils';
import { useBranch } from '@/components/admin/branch';

const DESIGNS: { id: PadDesign; label: string }[] = [
  { id: 'classic', label: 'Classic' }, { id: 'modern', label: 'Modern band' }, { id: 'side', label: 'Side panel' }, { id: 'minimal', label: 'Minimal' },
];

export default function RxPadSettings() {
  const supabase = createClient();
  const { branchId } = useBranch();
  const [doctors, setDoctors] = useState<any[]>([]);
  const [mineId, setMineId] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [cfg, setCfg] = useState<PadConfig>(mergePad());
  const [clinics, setClinics] = useState<any[]>([]);
  const [clinicId, setClinicId] = useState('');
  const [sample, setSample] = useState(true);
  const [write, setWrite] = useState(true);
  const [ov, setOv] = useState<Partial<PadData>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ t: 'green' | 'red'; s: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: docs }, { data: { user } }] = await Promise.all([
        supabase.from('doctors').select('id, full_name, qualification, specialty, profile_id').eq('active', true).order('full_name'),
        supabase.auth.getUser(),
      ]);
      const mine = docs?.find((d) => d.profile_id === user?.id);
      setDoctors(mine ? [mine] : docs || []);
      setMineId(mine?.id || null);
      setDoctorId(mine?.id || docs?.[0]?.id || '');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doctor = useMemo(() => doctors.find((d) => d.id === doctorId), [doctors, doctorId]);

  useEffect(() => { setOv({}); }, [doctorId, sample]);

  useEffect(() => {
    if (!doctorId) return;
    (async () => {
      const [{ data: s }, { data: br }] = await Promise.all([
        supabase.from('rx_pad_settings').select('config').eq('doctor_id', doctorId).maybeSingle(),
        supabase.from('branches').select('id, name, address, phone, timings').eq('active', true).order('name'),
      ]);
      const d = doctors.find((x) => x.id === doctorId);
      const base = mergePad(s?.config);
      setCfg({ ...base, qualifications: base.qualifications || d?.qualification || '', speciality: base.speciality || d?.specialty || '' });
      setClinics(br || []);
      setClinicId((prev) => prev || ((br || []).some((b) => b.id === branchId) ? branchId! : (br || [])[0]?.id || ''));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);

  const set = <K extends keyof PadConfig>(k: K, v: PadConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const clinic = clinics.find((c) => c.id === clinicId);

  const base: PadData = {
    doctorName: doctor?.full_name || 'Dr. Name',
    clinic: clinicInfo(clinic || { name: 'Your clinic', address: 'Clinic address', phone: 'Phone' }),
    patient: sample ? { name: 'Sample Patient', mrn: 'MRN1001', age: '34y', sex: 'female', date: fmtDate(new Date()) } : {},
    vitals: sample ? { bp: '120/80', pulse: '72', temp: '98.6', weight: '68 kg', spo2: '98%' } : {},
    complaints: sample ? 'Fever and cough for 3 days' : '',
    diagnosis: sample ? 'Upper respiratory infection' : '',
    rxText: sample ? '1. Amoxicillin 500mg — 1 cap · Twice daily · 5 days (After food)\n2. Paracetamol 500mg — 1 tab · If fever · 3 days' : '',
    tests: sample ? ['CBC'] : [],
    advice: sample ? 'Drink plenty of fluids and rest.' : '',
  };
  const data: PadData = { ...base, ...ov };
  const edit: PadEdit | undefined = write
    ? { data: (p) => setOv((o) => ({ ...o, ...p })), cfg: (p) => setCfg((c) => ({ ...c, ...p })) }
    : undefined;

  const logoPick = (f?: File | null) => {
    if (!f) return;
    if (f.size > 400 * 1024) { setMsg({ t: 'red', s: 'Logo is too big. Please use an image under 400 KB.' }); return; }
    const r = new FileReader();
    r.onload = () => set('logo', String(r.result));
    r.readAsDataURL(f);
  };

  const save = async () => {
    if (!doctorId) return;
    setSaving(true); setMsg(null);
    const { error } = await supabase.from('rx_pad_settings').upsert({ doctor_id: doctorId, config: cfg, updated_at: new Date().toISOString() });
    setSaving(false);
    setMsg(error ? { t: 'red', s: error.message } : { t: 'green', s: 'Prescription pad saved. It will be used for every prescription from now on.' });
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!doctorId) return <Alert tone="amber">No doctor profile found. Ask the admin to add you under Settings → Doctors.</Alert>;

  const toggles: [keyof PadConfig, string][] = [
    ['show_patient_line', 'Patient name, age, sex and date line'], ['show_vitals', 'Vitals box (BP, pulse, temp, weight)'], ['show_rx_symbol', 'Rx symbol'],
    ['show_signature', 'Signature and follow-up line'], ['watermark', 'Faint logo watermark'],
  ];

  return (
    <div>
      <PageHeader title="Prescription Pad" subtitle="Design your pad once. Everything you write during a consultation is placed on it automatically."
        actions={<button className="btn-secondary no-print" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>} />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="no-print card space-y-4 self-start p-5">
          {mineId === null && (
            <Field label="Doctor">
              <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select>
            </Field>
          )}
          <Field label="Doctor name on the pad">
            <input className="input" placeholder={doctor?.full_name || 'Dr. Name'} value={cfg.doctor_name} onChange={(e) => set('doctor_name', e.target.value)} />
            <span className="mt-1 block text-xs text-ink-muted">Type the name exactly as it should be printed. Leave empty to use the doctor's profile name.</span>
          </Field>
          <Field label="Qualifications"><input className="input" placeholder="MBBS, FCPS (Dermatology)" value={cfg.qualifications} onChange={(e) => set('qualifications', e.target.value)} /></Field>
          <Field label="Speciality / designation"><input className="input" value={cfg.speciality} onChange={(e) => set('speciality', e.target.value)} /></Field>
          <Field label="Registration no. (optional)"><input className="input" placeholder="Reg. No. 12345-P" value={cfg.reg_no} onChange={(e) => set('reg_no', e.target.value)} /></Field>

          <Field label="Preview clinic">
            <select className="input" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
              {clinics.length === 0 && <option value="">No clinics yet</option>}
              {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-ink-muted">The pad automatically uses the name, address, phone and timings of the clinic the patient came to (set them in Settings → Branches).</span>
          </Field>

          <Field label="Footer note"><input className="input" value={cfg.footer_note} onChange={(e) => set('footer_note', e.target.value)} /></Field>

          <Field label="Logo (optional)">
            <div className="flex items-center gap-2">
              <label className="btn-secondary btn-sm cursor-pointer"><Upload size={14} /> Choose image
                <input type="file" accept="image/*" className="hidden" onChange={(e) => logoPick(e.target.files?.[0])} /></label>
              {cfg.logo && <><img src={cfg.logo} alt="" className="h-8 w-auto rounded" /><button className="btn-ghost btn-sm" onClick={() => set('logo', '')} aria-label="Remove logo"><X size={14} /></button></>}
            </div>
          </Field>

          <div>
            <span className="label">Design</span>
            <div className="flex flex-wrap gap-2">
              {DESIGNS.map((d) => (
                <button key={d.id} onClick={() => set('design', d.id)}
                  className={cn('rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1', cfg.design === d.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200')}>{d.label}</button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {PAD_COLORS.map((c) => (
                <button key={c} onClick={() => set('color', c)} aria-label={`Colour ${c}`} style={{ background: c }}
                  className={cn('h-7 w-7 rounded-full ring-offset-2', cfg.color === c && 'ring-2 ring-slate-900')} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Paper size"><select className="input" value={cfg.paper} onChange={(e) => set('paper', e.target.value as any)}><option>A4</option><option>A5</option></select></Field>
            <Field label="Font"><select className="input" value={cfg.font} onChange={(e) => set('font', e.target.value as any)}>
              <option value="serif">Classic serif</option><option value="sans">Modern sans</option><option value="mono">Typewriter</option></select></Field>
          </div>

          <div className="space-y-2">
            {toggles.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!cfg[k]} onChange={(e) => set(k, e.target.checked as any)} className="h-4 w-4 accent-brand-600" /> {label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} className="h-4 w-4 accent-brand-600" /> Write directly on the pad
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} className="h-4 w-4 accent-brand-600" /> Show sample content in the preview
            </label>
          </div>

          {msg && <Alert tone={msg.t}>{msg.s}</Alert>}
          <button className="btn-primary w-full" disabled={saving} onClick={save}>{saving ? <Spinner /> : <Save size={16} />} Save prescription pad</button>
          <p className="text-xs text-ink-muted">Tip: untick sample content and press Print to get a blank pad for pre-printing.</p>
        </div>

        <div className="min-w-0">
          {write && (
            <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <span>Click any text on the pad (name, medicines, advice, vitals) and type. Then press <b>Print / Save as PDF</b>.</span>
              {Object.keys(ov).length > 0 && <button className="btn-secondary btn-sm" onClick={() => setOv({})}><Eraser size={14} /> Clear typed text</button>}
            </div>
          )}
          <RxPadPrintable cfg={cfg} data={data} edit={edit} />
        </div>
      </div>
    </div>
  );
}
