'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Send, Check, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, Tabs, Empty, Spinner, Badge } from '@/components/ui';
import { cn, fmtDate, fmtDateTime } from '@/lib/utils';

export default function Inbox() {
  const supabase = createClient();
  const [tab, setTab] = useState('messages');
  const [threads, setThreads] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [body, setBody] = useState('');
  const [myDoctor, setMyDoctor] = useState<string | null>(null);
  const [mine, setMine] = useState(true);
  const [refills, setRefills] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      const { data } = await supabase.from('doctors').select('id').eq('profile_id', user?.id).maybeSingle();
      setMyDoctor(data?.id || null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase.from('patient_messages').select('patient_id, doctor_id, body, sender_type, read_by_staff_at, created_at, patients(first_name, last_name, mrn)').order('created_at', { ascending: false }).limit(500);
    const map = new Map<string, any>();
    (data || []).forEach((m: any) => {
      if (myDoctor && mine && m.doctor_id && m.doctor_id !== myDoctor) return;
      const t = map.get(m.patient_id) || { patient_id: m.patient_id, patient: m.patients, last: m, unread: 0 };
      if (m.sender_type === 'patient' && !m.read_by_staff_at) t.unread++;
      map.set(m.patient_id, t);
    });
    setThreads(Array.from(map.values()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDoctor, mine]);

  const loadThread = useCallback(async (pid: string) => {
    const { data } = await supabase.from('patient_messages').select('*, doctors(full_name), profiles(full_name)').eq('patient_id', pid).order('created_at');
    setMsgs(data || []);
    await supabase.rpc('messages_mark_read', { p_patient: pid });
    setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 50);
    loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThreads]);

  const loadRefills = useCallback(async () => {
    let q = supabase.from('refill_requests').select('*, patients(id, first_name, last_name, mrn), doctors(full_name)').order('created_at', { ascending: false }).limit(100);
    if (myDoctor && mine) q = q.or(`doctor_id.eq.${myDoctor},doctor_id.is.null`);
    const { data } = await q;
    setRefills(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDoctor, mine]);

  useEffect(() => {
    loadThreads(); loadRefills();
    const ch = supabase.channel('inbox').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_messages' }, (p: any) => {
      loadThreads();
      if (sel && p.new?.patient_id === sel.patient_id) loadThread(sel.patient_id);
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThreads, loadRefills, sel?.patient_id]);

  const reply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !sel) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('patient_messages').insert({ patient_id: sel.patient_id, doctor_id: myDoctor, sender_id: user?.id, sender_type: 'staff', body: body.trim() });
    setBusy(false);
    if (error) return alert(error.message);
    setBody(''); loadThread(sel.patient_id);
  };

  const answer = async (r: any, status: 'approved' | 'denied') => {
    const response = prompt(status === 'approved' ? 'Note for the patient (optional)' : 'Reason (shown to the patient)', status === 'approved' ? 'Approved. Ready at the pharmacy.' : '');
    if (response === null) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('refill_requests').update({ status, response, responded_by: user?.id, responded_at: new Date().toISOString() }).eq('id', r.id);
    if (error) return alert(error.message);
    loadRefills();
  };

  const pendingRefills = refills.filter((r) => r.status === 'requested').length;
  const unread = threads.reduce((s, t) => s + t.unread, 0);

  return (
    <div>
      <PageHeader title="Patient Inbox" subtitle="Messages from the patient portal and prescription refill requests."
        actions={myDoctor ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine & care team</label> : undefined} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'messages', label: `Messages${unread ? ` (${unread})` : ''}` }, { id: 'refills', label: `Refill requests${pendingRefills ? ` (${pendingRefills})` : ''}` }]} />

      {tab === 'messages' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className={cn('card min-w-0 divide-y divide-slate-100 lg:block', sel && 'hidden')}>
            {threads.length === 0 && <Empty text="No messages." />}
            {threads.map((t) => (
              <button key={t.patient_id} onClick={() => { setSel(t); loadThread(t.patient_id); }}
                className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50', sel?.patient_id === t.patient_id && 'bg-brand-50/60')}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{t.patient?.first_name?.[0]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2"><p className={cn('truncate text-sm', t.unread ? 'font-bold' : 'font-semibold')}>{t.patient?.first_name} {t.patient?.last_name}</p><span className="shrink-0 text-[11px] text-ink-muted">{fmtDate(t.last.created_at)}</span></div>
                  <p className="truncate text-xs text-ink-soft">{t.last.sender_type === 'staff' ? 'You: ' : ''}{t.last.body}</p>
                </div>
                {t.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{t.unread}</span>}
              </button>
            ))}
          </div>
          <div className={cn('card flex min-w-0 flex-col lg:col-span-2', !sel && 'hidden lg:flex')}>
            {!sel ? <Empty text="Choose a conversation." /> : (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <button className="btn-ghost btn-sm lg:hidden" onClick={() => setSel(null)}>← Back</button>
                  <Link href={`/admin/patients/${sel.patient_id}`} className="font-semibold hover:text-brand-700">{sel.patient?.first_name} {sel.patient?.last_name} <span className="text-xs font-normal text-ink-muted">{sel.patient?.mrn}</span></Link>
                </div>
                <div className="max-h-[55vh] min-h-[260px] flex-1 space-y-3 overflow-y-auto p-4">
                  {msgs.map((m) => {
                    const staff = m.sender_type === 'staff';
                    return (
                      <div key={m.id} className={cn('flex', staff ? 'justify-end' : 'justify-start')}>
                        <div className={cn('max-w-[80%] rounded-2xl px-4 py-2.5 text-sm', staff ? 'bg-brand-600 text-white' : 'bg-slate-100')}>
                          <p className="whitespace-pre-wrap">{m.body}</p>
                          <p className={cn('mt-1 text-[10px]', staff ? 'text-brand-100' : 'text-ink-muted')}>{staff ? m.profiles?.full_name || 'Staff' : `Patient${m.doctors ? ` → ${m.doctors.full_name}` : ' → care team'}`} · {fmtDateTime(m.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={end} />
                </div>
                <form onSubmit={reply} className="flex gap-2 border-t border-slate-100 p-3">
                  <textarea className="input min-h-[44px]" rows={2} placeholder="Reply to the patient..." value={body} onChange={(e) => setBody(e.target.value)} />
                  <button className="btn-primary self-end" disabled={busy || !body.trim()}>{busy ? <Spinner /> : <Send size={16} />}</button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'refills' && (
        <div className="card divide-y divide-slate-100">
          {refills.length === 0 && <Empty text="No refill requests." />}
          {refills.map((r) => (
            <div key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{r.medicine_name} <span className="font-normal text-ink-soft">for</span> <Link href={`/admin/patients/${r.patients?.id}`} className="hover:text-brand-700">{r.patients?.first_name} {r.patients?.last_name}</Link></p>
                <p className="text-xs text-ink-soft">{fmtDateTime(r.created_at)}{r.doctors ? ` · ${r.doctors.full_name}` : ''}{r.note ? ` · "${r.note}"` : ''}</p>
                {r.response && <p className="text-xs text-ink-muted">Response: {r.response}</p>}
              </div>
              <div className="flex items-center gap-2">
                {r.status === 'requested' ? (
                  <>
                    <button className="btn-primary btn-sm" onClick={() => answer(r, 'approved')}><Check size={14} /> Approve</button>
                    <button className="btn-secondary btn-sm text-rose-600" onClick={() => answer(r, 'denied')}><X size={14} /> Deny</button>
                  </>
                ) : <Badge tone={r.status === 'approved' || r.status === 'dispensed' ? 'green' : 'red'}>{r.status}</Badge>}
              </div>
            </div>
          ))}
          <p className="px-5 py-3 text-xs text-ink-muted">Approved refills count as a valid prescription at the pharmacy POS for 30 days.</p>
        </div>
      )}
    </div>
  );
}
