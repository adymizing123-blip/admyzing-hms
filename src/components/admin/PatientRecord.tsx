'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Upload, FileText, Phone, Mail, AlertTriangle, CalendarDays, Receipt, FlaskConical, BedDouble, MessageCircle } from 'lucide-react';
import SendMessage from '@/components/admin/SendMessage';
import dynamic from 'next/dynamic';
const DicomViewer = dynamic(() => import('@/components/admin/DicomViewer'), { ssr: false });
import { createClient } from '@/lib/supabase/client';
import { Modal, StatusBadge, Tabs, Empty, Alert, Spinner } from '@/components/ui';
import { FormField } from '@/components/admin/ResourceManager';
import { patientFields } from '@/lib/fields';
import { SourceBadge } from '@/components/admin/ChannelBadge';
import { age, cn, fmtDate, fmtDateTime, money } from '@/lib/utils';

export default function PatientRecord({ role, patient, appointments, visits, labs, invoices, admissions, documents, immunizations = [] }: any) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState('visits');
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msgOpen, setMsgOpen] = useState(false);
  const [dicom, setDicom] = useState<{ url: string; title: string } | null>(null);
  const [opts, setOpts] = useState<Record<string, { value: string; label: string }[]>>({});

  const balance = invoices.reduce((s: number, i: any) => s + (['unpaid', 'partial'].includes(i.status) ? Number(i.total) - Number(i.amount_paid) : 0), 0);

  const openEdit = () => {
    const f: any = {};
    patientFields.forEach((x) => (f[x.name] = patient[x.name] ?? ''));
    setForm(f);
    setEditOpen(true);
    // dropdowns filled from a table (e.g. Clinic)
    patientFields.filter((x) => x.optionsFrom && !opts[x.name]).forEach(async (x) => {
      const o = x.optionsFrom!;
      const { data } = await supabase.from(o.table).select(o.select || '*').order(o.order || 'id');
      setOpts((p) => ({ ...p, [x.name]: (data || []).map((r: any) => ({ value: r[o.value || 'id'], label: o.label(r) })) }));
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const payload: any = {};
    patientFields.forEach((x) => (payload[x.name] = form[x.name] === '' ? null : form[x.name]));
    const { error } = await supabase.from('patients').update(payload).eq('id', patient.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditOpen(false);
    router.refresh();
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const title = prompt('Document title', file.name) || file.name;
    const path = `${patient.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error } = await supabase.storage.from('documents').upload(path, file);
    if (error) return alert(error.message);
    await supabase.from('patient_documents').insert({ patient_id: patient.id, title, file_path: path });
    router.refresh();
  };

  const openDoc = async (path: string, title = '') => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 600);
    if (error) return alert(error.message);
    if (/\.(dcm|dicom)$/i.test(path)) return setDicom({ url: data.signedUrl, title });
    window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="mt-4 space-y-6">
      <div className="card p-5 sm:p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-100 text-xl font-bold text-brand-700">
              {patient.first_name[0]}{patient.last_name[0]}
            </span>
            <div>
              <h1 className="text-xl font-bold">{patient.first_name} {patient.last_name}</h1>
              <p className="text-sm text-ink-soft">{patient.mrn} · {age(patient.dob)} · {patient.gender || '-'} · Blood {patient.blood_group || '-'}</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                {patient.phone && <a href={`tel:${patient.phone}`} className="flex items-center gap-1"><Phone size={13} />{patient.phone}</a>}
                {patient.email && <a href={`mailto:${patient.email}`} className="flex items-center gap-1"><Mail size={13} />{patient.email}</a>}
                {patient.source && <SourceBadge source={patient.source} detail={patient.source_detail} />}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={openEdit}><Pencil size={14} /> Edit</button>
            {(patient.phone || patient.email) && <button className="btn-secondary btn-sm" onClick={() => setMsgOpen(true)}><MessageCircle size={14} /> Message</button>}
            <Link href={`/admin/appointments?patient=${patient.id}`} className="btn-secondary btn-sm"><CalendarDays size={14} /> Book visit</Link>
            <Link href={`/admin/lab?new=${patient.id}`} className="btn-secondary btn-sm"><FlaskConical size={14} /> Lab order</Link>
            <Link href={`/admin/billing/new?patient=${patient.id}`} className="btn-secondary btn-sm"><Receipt size={14} /> New bill</Link>
            <Link href={`/admin/ipd?admit=${patient.id}`} className="btn-secondary btn-sm"><BedDouble size={14} /> Admit</Link>
            <Link href={`/admin/referrals?new=${patient.id}`} className="btn-secondary btn-sm">Refer</Link>
          </div>
        </div>
        {patient.marketing_opt_out && <p className="mt-3 text-xs text-ink-muted">Opted out of marketing messages</p>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Allergies" value={patient.allergies} warn />
          <Info label="Chronic conditions" value={patient.chronic_conditions} />
          <Info label="Insurance" value={patient.insurance_provider ? `${patient.insurance_provider} · ${patient.insurance_member_id || ''}` : null} />
          <Info label="Balance due" value={money(balance)} />
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'visits', label: `Visits (${visits.length})` },
        { id: 'appointments', label: `Appointments (${appointments.length})` },
        { id: 'labs', label: `Lab (${labs.length})` },
        { id: 'admissions', label: `Admissions (${admissions.length})` },
        { id: 'bills', label: `Bills (${invoices.length})` },
        { id: 'docs', label: `Documents (${documents.length})` },
        { id: 'imm', label: `Immunizations (${immunizations.length})` },
      ]} />

      {tab === 'visits' && (
        <div className="space-y-4">
          {visits.length === 0 && <div className="card"><Empty text="No visits recorded." /></div>}
          {visits.map((v: any) => (
            <div key={v.id} className="card p-5">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold">{v.doctors?.full_name}</p>
                <p className="text-sm text-ink-soft">{fmtDateTime(v.created_at)}</p>
              </div>
              {Object.keys(v.vitals || {}).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(v.vitals).filter(([, x]) => x).map(([k, x]) => (
                    <span key={k} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs"><span className="font-semibold uppercase">{k}</span> {String(x)}</span>
                  ))}
                </div>
              )}
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {v.complaints && <p><span className="font-semibold">Complaints:</span> {v.complaints}</p>}
                {v.diagnosis && <p><span className="font-semibold">Diagnosis:</span> {v.diagnosis}</p>}
                {v.notes && <p className="sm:col-span-2"><span className="font-semibold">Notes:</span> {v.notes}</p>}
              </div>
              {v.prescriptions?.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-xl bg-brand-50/60 p-3 text-sm">
                  {v.prescriptions.map((p: any) => <li key={p.id}><span className="font-semibold">{p.medicine_name}</span> {p.dosage} · {p.frequency} · {p.duration}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'appointments' && (
        <ListCard empty={appointments.length === 0}>
          {appointments.map((a: any) => (
            <Row key={a.id} left={<><p className="font-semibold">{a.doctors?.full_name}</p><p className="text-xs text-ink-soft">{fmtDateTime(a.scheduled_at)} · {a.reason || 'No reason'}</p></>} right={<StatusBadge status={a.status} />} />
          ))}
        </ListCard>
      )}

      {tab === 'labs' && (
        <div className="space-y-4">
          {labs.length === 0 && <div className="card"><Empty /></div>}
          {labs.map((o: any) => (
            <Link href={`/admin/lab/${o.id}`} key={o.id} className="card block p-5 hover:border-brand-200">
              <div className="flex justify-between"><p className="font-semibold">{o.order_no}</p><StatusBadge status={o.status} /></div>
              <ul className="mt-2 text-sm">
                {o.lab_order_items.map((i: any) => (
                  <li key={i.id} className="flex justify-between py-0.5"><span>{i.lab_tests?.name}</span>
                    <span className={cn(i.flag && i.flag !== 'normal' && 'font-semibold text-rose-600')}>{i.result ? `${i.result} ${i.lab_tests?.unit || ''}` : '-'}</span></li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      )}

      {tab === 'admissions' && (
        <ListCard empty={admissions.length === 0}>
          {admissions.map((a: any) => (
            <Link key={a.id} href={`/admin/ipd/${a.id}`} className="block hover:bg-slate-50">
              <Row left={<><p className="font-semibold">{a.beds?.wards?.name} · {a.beds?.bed_no}</p><p className="text-xs text-ink-soft">{fmtDate(a.admitted_at)} to {a.discharged_at ? fmtDate(a.discharged_at) : 'now'} · {a.reason}</p></>} right={<StatusBadge status={a.status} />} />
            </Link>
          ))}
        </ListCard>
      )}

      {tab === 'bills' && (
        <ListCard empty={invoices.length === 0}>
          {invoices.map((i: any) => (
            <Link key={i.id} href={`/admin/billing/${i.id}`} className="block hover:bg-slate-50">
              <Row left={<><p className="font-semibold">{i.invoice_no}</p><p className="text-xs text-ink-soft">{fmtDate(i.created_at)}</p></>}
                right={<div className="flex items-center gap-3"><span className="font-bold">{money(i.total)}</span><StatusBadge status={i.status} /></div>} />
            </Link>
          ))}
        </ListCard>
      )}

      {tab === 'imm' && (
        <div className="card">
          <div className="flex justify-end border-b border-slate-100 p-4"><Link href="/admin/immunizations" className="btn-primary btn-sm">Record vaccine</Link></div>
          {immunizations.length === 0 ? <Empty text="No immunizations on record." /> : (
            <ul className="divide-y divide-slate-100">
              {immunizations.map((i: any) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><b>{i.vaccines?.name}</b> · dose {i.dose_number} · {fmtDate(i.given_on)}{i.lot_number ? ` · lot ${i.lot_number}` : ''}</span>
                  {i.next_due_on && <span className="text-xs text-ink-soft">Next due {fmtDate(i.next_due_on)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div className="card">
          <div className="flex justify-end border-b border-slate-100 p-4">
            <label className="btn-primary btn-sm cursor-pointer"><Upload size={14} /> Upload file<input type="file" className="hidden" onChange={upload} /></label>
          </div>
          {documents.length === 0 ? <Empty text="No documents uploaded." /> : (
            <ul className="divide-y divide-slate-100">
              {documents.map((d: any) => (
                <li key={d.id}><button onClick={() => openDoc(d.file_path, d.title)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                  <FileText size={18} className="text-brand-600" /><span className="flex-1 text-sm font-medium">{d.title}{/\.(dcm|dicom)$/i.test(d.file_path) && <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">DICOM</span>}</span><span className="text-xs text-ink-muted">{fmtDate(d.created_at)}</span>
                </button></li>
              ))}
            </ul>
          )}
        </div>
      )}

      <SendMessage open={msgOpen} onClose={() => setMsgOpen(false)} to={{ name: `${patient.first_name} ${patient.last_name}`, phone: patient.phone, email: patient.email, patient_id: patient.id }} />

      <Modal open={!!dicom} onClose={() => setDicom(null)} title={dicom?.title || 'Image'} wide>
        {dicom && <DicomViewer url={dicom.url} />}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit patient" wide>
        <form onSubmit={save} className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            {patientFields.map((f) => <FormField key={f.name} f={f} value={form[f.name]} options={f.options || opts[f.name] || []} onChange={(v) => setForm({ ...form, [f.name]: v })} />)}
          </div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Save</button></div>
        </form>
      </Modal>
    </div>
  );
}

function Info({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl p-3', warn && value ? 'bg-rose-50' : 'bg-slate-50')}>
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{warn && value && <AlertTriangle size={12} className="text-rose-600" />}{label}</p>
      <p className={cn('mt-0.5 text-sm font-medium', warn && value && 'text-rose-700')}>{value || 'None recorded'}</p>
    </div>
  );
}

function ListCard({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  return <div className="card divide-y divide-slate-100">{empty ? <Empty /> : children}</div>;
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-5 py-3"><div className="min-w-0">{left}</div>{right}</div>;
}
