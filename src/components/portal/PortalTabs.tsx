'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, FileText, FlaskConical, Receipt, Package, User, Video, Send, Upload, RefreshCw, CreditCard, Syringe } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { StatusBadge, Tabs, Empty, Alert, Spinner, Badge } from '@/components/ui';
import { useT } from '@/components/site/lang';
import { fmtDate, fmtDateTime, money, cn } from '@/lib/utils';

export default function PortalTabs({ patient, appointments, visits, labs, invoices, orders, admissions, documents, immunizations, refills, doctors }: any) {
  const t = useT();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'appointments');
  const router = useRouter();
  const supabase = createClient();
  const upcoming = appointments.filter((a: any) => new Date(a.scheduled_at) > new Date() && a.status === 'booked');
  const due = invoices.reduce((s: number, i: any) => s + (i.status === 'unpaid' || i.status === 'partial' ? Number(i.total) - Number(i.amount_paid) : 0), 0);
  const [payErr, setPayErr] = useState('');
  const [paying, setPaying] = useState('');

  const cancel = async (id: string) => {
    if (!confirm(t('Cancel') + '?')) return;
    const { error } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id);
    if (error) alert(error.message);
    router.refresh();
  };

  const pay = async (id: string) => {
    setPaying(id); setPayErr('');
    const res = await fetch('/api/pay-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: id }) });
    const d = await res.json();
    setPaying('');
    if (!res.ok) return setPayErr(d.error);
    window.location.href = d.url;
  };

  const requestRefill = async (p: any, v: any) => {
    const note = prompt(t('Request refill') + ': ' + p.medicine_name, '');
    if (note === null) return;
    const { error } = await supabase.from('refill_requests').insert({
      patient_id: patient.id, prescription_id: p.id, medicine_id: p.medicine_id, medicine_name: p.medicine_name, doctor_id: v.doctor_id, note: note || null,
    });
    if (error) return alert(error.message);
    router.refresh();
  };

  const refillFor = (pid: string) => refills.find((r: any) => r.prescription_id === pid && ['requested', 'approved'].includes(r.status));

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold">{t('Hi,')} {patient.first_name}</h1>
        <p className="text-sm text-ink-soft">MRN {patient.mrn}</p>
      </div>
      {params.get('paid') && <div className="mt-4"><Alert tone="green">Payment received for {params.get('paid')}. Thank you!</Alert></div>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: <CalendarDays size={18} />, l: t('Upcoming visits'), v: upcoming.length },
          { icon: <FileText size={18} />, l: t('Past visits'), v: visits.length },
          { icon: <FlaskConical size={18} />, l: t('Lab results'), v: labs.filter((l: any) => l.status === 'completed').length },
          { icon: <Receipt size={18} />, l: t('Balance due'), v: money(due) },
        ].map((s) => (
          <div key={s.l} className="card p-4"><span className="text-brand-600">{s.icon}</span><p className="mt-2 text-xl font-bold">{s.v}</p><p className="text-xs text-ink-soft">{s.l}</p></div>
        ))}
      </div>

      <div className="mt-8">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'appointments', label: t('Appointments') },
          { id: 'messages', label: t('Messages') },
          { id: 'visits', label: t('Visits & Prescriptions') },
          { id: 'labs', label: t('Lab Results') },
          { id: 'bills', label: t('Bills') },
          { id: 'docs', label: t('Documents') },
          { id: 'imm', label: t('Immunizations') },
          { id: 'orders', label: t('Store Orders') },
          { id: 'profile', label: t('My Profile') },
        ]} />

        {tab === 'appointments' && (
          <div className="card divide-y divide-slate-100">
            {appointments.length === 0 && <Empty text={t('No appointments yet.')} />}
            {appointments.map((a: any) => (
              <div key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{a.doctors?.full_name} <span className="font-normal text-ink-soft">· {a.doctors?.specialty}</span></p>
                  <p className="text-sm text-ink-soft">{fmtDateTime(a.scheduled_at)}{a.visit_type === 'video' ? ` · ${t('Video visit')}` : a.token_no ? ` · #${a.token_no}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.status} />
                  {a.visit_type === 'video' && a.video_url && ['booked', 'checked_in', 'in_consultation'].includes(a.status) && new Date(a.scheduled_at).getTime() > Date.now() - 2 * 3600e3 && (
                    <a href={a.video_url} target="_blank" rel="noreferrer" className="btn-primary btn-sm"><Video size={14} /> {t('Join video')}</a>
                  )}
                  {a.status === 'booked' && new Date(a.scheduled_at) > new Date() && <button className="btn-secondary btn-sm text-rose-600" onClick={() => cancel(a.id)}>{t('Cancel')}</button>}
                </div>
              </div>
            ))}
            <div className="p-4"><Link href="/book" className="btn-primary btn-sm">{t('Book a new appointment')}</Link></div>
          </div>
        )}

        {tab === 'messages' && <Messages patient={patient} doctors={doctors} />}

        {tab === 'visits' && (
          <div className="space-y-4">
            {refills.length > 0 && (
              <div className="card p-4">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><RefreshCw size={15} className="text-brand-600" /> {t('Refill requests')}</p>
                <ul className="space-y-1 text-sm">
                  {refills.map((r: any) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{r.medicine_name} <span className="text-xs text-ink-muted">· {fmtDate(r.created_at)}</span>{r.response && <span className="block text-xs text-ink-soft">{r.response}</span>}</span>
                      <Badge tone={r.status === 'approved' || r.status === 'dispensed' ? 'green' : r.status === 'denied' ? 'red' : 'amber'}>{t(r.status === 'requested' ? 'Pending' : r.status[0].toUpperCase() + r.status.slice(1))}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {visits.length === 0 && <div className="card"><Empty text={t('No visit records yet.')} /></div>}
            {visits.map((v: any) => (
              <div key={v.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{v.doctors?.full_name}</p><p className="text-sm text-ink-soft">{fmtDate(v.created_at)}</p></div>
                {v.diagnosis && <p className="mt-2 text-sm"><span className="font-semibold">{t('Diagnosis:')}</span> {v.diagnosis}</p>}
                {v.follow_up_date && <p className="mt-1 text-sm text-ink-soft">{t('Follow-up on')} {fmtDate(v.follow_up_date)}</p>}
                {v.prescriptions?.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50"><tr><th className="th">{t('Medicine')}</th><th className="th">{t('Dosage')}</th><th className="th">{t('Frequency')}</th><th className="th">{t('Duration')}</th><th className="th" /></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {v.prescriptions.map((p: any) => (
                          <tr key={p.id}>
                            <td className="td font-medium">{p.medicine_name}</td><td className="td">{p.dosage}</td><td className="td">{p.frequency}</td><td className="td">{p.duration}</td>
                            <td className="td text-right">{refillFor(p.id) ? <span className="text-xs text-ink-muted">{t('Refill requested')}</span> : <button className="btn-secondary btn-sm" onClick={() => requestRefill(p, v)}><RefreshCw size={12} /> {t('Request refill')}</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'labs' && (
          <div className="space-y-4">
            {labs.length === 0 && <div className="card"><Empty text={t('No lab orders yet.')} /></div>}
            {labs.map((o: any) => (
              <div key={o.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{o.order_no}</p><div className="flex items-center gap-2"><span className="text-sm text-ink-soft">{fmtDate(o.ordered_at)}</span><StatusBadge status={o.status} /></div></div>
                {o.status === 'completed' ? (
                  <ul className="mt-3 divide-y divide-slate-100 text-sm">
                    {o.lab_order_items.map((i: any) => (
                      <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{i.lab_tests?.name}</span>
                        <span className={cn('font-semibold', i.flag && i.flag !== 'normal' && 'text-rose-600')}>{i.result} {i.lab_tests?.unit} <span className="font-normal text-ink-muted">({i.lab_tests?.normal_range})</span></span></li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-sm text-ink-muted">{t('Results will appear here once completed.')}</p>}
              </div>
            ))}
          </div>
        )}

        {tab === 'bills' && (
          <div className="space-y-3">
            {payErr && <Alert>{payErr}</Alert>}
            <div className="card divide-y divide-slate-100">
              {invoices.length === 0 && <Empty text={t('No bills yet.')} />}
              {invoices.map((i: any) => {
                const bal = Number(i.total) - Number(i.amount_paid);
                return (
                  <details key={i.id} className="group p-4">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                      <div><p className="font-semibold">{i.invoice_no}</p><p className="text-sm text-ink-soft">{fmtDate(i.created_at)}</p></div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold">{money(i.total)}</span><StatusBadge status={i.status} />
                        {['unpaid', 'partial'].includes(i.status) && bal > 0 && (
                          <button className="btn-primary btn-sm" disabled={paying === i.id} onClick={(e) => { e.preventDefault(); pay(i.id); }}>{paying === i.id ? <Spinner /> : <CreditCard size={14} />} {t('Pay now')} {money(bal)}</button>
                        )}
                      </div>
                    </summary>
                    <ul className="mt-3 space-y-1 text-sm">
                      {i.invoice_items.map((it: any) => <li key={it.id} className="flex justify-between"><span className="text-ink-soft">{it.description} × {Number(it.quantity)}</span><span>{money(it.line_total)}</span></li>)}
                      <li className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><span>{t('Paid')}</span><span>{money(i.amount_paid)}</span></li>
                    </ul>
                  </details>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'docs' && <Documents patient={patient} documents={documents} />}

        {tab === 'imm' && (
          <div className="card divide-y divide-slate-100">
            {immunizations.length === 0 && <Empty text={t('No immunizations on record.')} />}
            {immunizations.map((i: any) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <span className="flex items-center gap-2"><Syringe size={15} className="text-brand-600" /><b>{i.vaccines?.name}</b> · {t('Dose')} {i.dose_number} · {fmtDate(i.given_on)}</span>
                {i.next_due_on && <span className="text-xs text-ink-soft">{t('Next dose due')}: {fmtDate(i.next_due_on)}</span>}
              </div>
            ))}
          </div>
        )}

        {tab === 'orders' && (
          <div className="card divide-y divide-slate-100">
            {orders.length === 0 && <Empty text={t('No store orders yet.')} />}
            {orders.map((o: any) => (
              <div key={o.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Package size={16} className="text-brand-600" /><p className="font-semibold">{o.order_no}</p></div><div className="flex items-center gap-3"><span className="font-bold">{money(o.total)}</span><StatusBadge status={o.status} /></div></div>
                <p className="mt-1 text-sm text-ink-soft">{o.order_items.map((i: any) => `${i.name} × ${i.quantity}`).join(', ')}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'profile' && <ProfileForm patient={patient} admissions={admissions} />}
      </div>
    </div>
  );
}

function Messages({ patient, doctors }: any) {
  const t = useT();
  const supabase = createClient();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('patient_messages').select('*, doctors(full_name), profiles(full_name)').eq('patient_id', patient.id).order('created_at');
    setMsgs(data || []);
    supabase.rpc('messages_mark_read', { p_patient: patient.id });
    setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`pm-${patient.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_messages', filter: `patient_id=eq.${patient.id}` }, () => load()).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('patient_messages').insert({ patient_id: patient.id, doctor_id: doctorId || null, sender_id: user?.id, sender_type: 'patient', body: body.trim() });
    setBusy(false);
    if (error) return alert(error.message);
    setBody(''); load();
  };

  return (
    <div className="card flex flex-col">
      <div className="max-h-[50vh] min-h-[240px] space-y-3 overflow-y-auto p-4">
        {msgs.length === 0 && <Empty text={t('No messages yet.')} />}
        {msgs.map((m) => {
          const mine = m.sender_type === 'patient';
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 text-sm', mine ? 'bg-brand-600 text-white' : 'bg-slate-100')}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={cn('mt-1 text-[10px]', mine ? 'text-brand-100' : 'text-ink-muted')}>{mine ? (m.doctors?.full_name ? `To ${m.doctors.full_name}` : t('Care team (general)')) : m.profiles?.full_name || 'Care team'} · {fmtDateTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="space-y-2 border-t border-slate-100 p-4">
        <p className="text-sm font-semibold">{t('Send a message to your care team')}</p>
        <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">{t('Care team (general)')}</option>
          {doctors.map((d: any) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <div className="flex gap-2">
          <textarea className="input min-h-[44px]" rows={2} placeholder={t('Type your message...')} value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn-primary self-end" disabled={busy || !body.trim()}>{busy ? <Spinner /> : <Send size={16} />} <span className="hidden sm:inline">{t('Send')}</span></button>
        </div>
        <p className="text-xs text-ink-muted">{t('For emergencies call 911. Messages are answered during clinic hours.')}</p>
      </form>
    </div>
  );
}

function Documents({ patient, documents }: any) {
  const t = useT();
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return alert('Max 20 MB');
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const path = `${patient.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { error } = await supabase.storage.from('documents').upload(path, file);
    if (!error) await supabase.from('patient_documents').insert({ patient_id: patient.id, title: file.name, file_path: path, uploaded_by: user?.id });
    setBusy(false);
    if (error) return alert(error.message);
    router.refresh();
  };

  const open = async (path: string) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 300);
    if (error) return alert(error.message);
    window.open(data.signedUrl, '_blank');
  };

  return (
    <div className="card">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-soft">{t('Upload insurance cards, outside lab results or referral letters.')}</p>
        <label className="btn-primary btn-sm cursor-pointer">{busy ? <Spinner /> : <Upload size={14} />} {t('Upload a document')}<input type="file" className="hidden" accept="image/*,.pdf,.dcm" onChange={upload} /></label>
      </div>
      {documents.length === 0 ? <Empty text={t('No documents yet.')} /> : (
        <ul className="divide-y divide-slate-100">
          {documents.map((d: any) => (
            <li key={d.id}><button onClick={() => open(d.file_path)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
              <FileText size={18} className="text-brand-600" /><span className="flex-1 text-sm font-medium">{d.title}</span><span className="text-xs text-ink-muted">{fmtDate(d.created_at)}</span><span className="text-xs font-semibold text-brand-700">{t('View')}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProfileForm({ patient, admissions }: any) {
  const t = useT();
  const [f, setF] = useState({ ...patient });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const keys: [string, string, string?][] = [
    ['first_name', 'First name'], ['last_name', 'Last name'], ['dob', 'Date of birth', 'date'], ['phone', 'Phone', 'tel'],
    ['address', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
    ['insurance_provider', 'Insurance provider'], ['insurance_member_id', 'Member ID'],
    ['emergency_contact_name', 'Emergency contact'], ['emergency_contact_phone', 'Emergency phone', 'tel'],
  ];
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const payload: any = { marketing_opt_out: !!f.marketing_opt_out };
    keys.forEach(([k]) => (payload[k] = f[k] || null));
    const { error } = await createClient().from('patients').update(payload).eq('id', patient.id);
    setBusy(false);
    setMsg(error ? error.message : t('Profile saved.'));
  };
  return (
    <form onSubmit={save} className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 font-semibold"><User size={18} className="text-brand-600" /> {t('Personal & insurance details')}</div>
      {msg && <div className="mb-4"><Alert tone={msg === t('Profile saved.') ? 'green' : 'red'}>{msg}</Alert></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map(([k, l, ty]) => (
          <label key={k} className="block"><span className="label">{t(l)}</span><input className="input" type={ty || 'text'} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
        ))}
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!f.marketing_opt_out} onChange={(e) => setF({ ...f, marketing_opt_out: e.target.checked })} /> {t('Do not send me health tips and offers')}</label>
      <button className="btn-primary mt-5" disabled={busy}>{busy && <Spinner />} {t('Save changes')}</button>
      {admissions.length > 0 && <p className="mt-4 text-xs text-ink-muted">Hospital stays on record: {admissions.length}</p>}
    </form>
  );
}
