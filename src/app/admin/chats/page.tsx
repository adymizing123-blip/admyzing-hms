'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, CalendarPlus, CheckCircle2, Paperclip, RotateCcw, Search, Send, Settings2, UserPlus, AlertTriangle, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Empty, Modal, PageHeader, Spinner, Badge } from '@/components/ui';
import ResourceManager from '@/components/admin/ResourceManager';
import NewAppointment from '@/components/admin/NewAppointment';
import { ChannelDot, SourceBadge, CHANNEL_META } from '@/components/admin/ChannelBadge';
import { cn, fmtDate, fmtDateTime, fmtTime, fullName } from '@/lib/utils';

const DAY = 24 * 3600e3;
const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'sms'];

const when = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? fmtTime(iso) : fmtDate(iso).replace(/, \d{4}$/, '');
};
const who = (c: any) => (c?.patients ? fullName(c.patients) : c?.contact_name || c?.leads?.name || c?.external_id || 'Unknown');

/** WhatsApp, Facebook, Instagram and SMS chats from every clinic in one inbox. */
export default function Chats() {
  const supabase = createClient();
  const [role, setRole] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clinics, setClinics] = useState<any[]>([]);
  const [f, setF] = useState({ channel: '', clinic: '', status: 'open', unread: false, q: '' });
  const [selId, setSelId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [tpl, setTpl] = useState({ open: false, name: '', language: 'en', params: '' });
  const [setup, setSetup] = useState(false);
  const [book, setBook] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const sel = useMemo(() => list.find((c) => c.id === selId) || null, [list, selId]);

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('active', true).order('name').then(({ data }) => setClinics(data || []));
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setRole(data?.role || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = useCallback(async () => {
    let q = supabase.from('conversations')
      .select('*, patients(id, first_name, last_name, mrn, phone, source), leads(id, name, status, source, source_detail), branches(id, name), channel_accounts(name)')
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(150);
    if (f.channel) q = q.eq('channel', f.channel);
    if (f.clinic) q = q.eq('branch_id', f.clinic);
    if (f.status) q = q.eq('status', f.status);
    if (f.unread) q = q.gt('unread', 0);
    if (f.q.trim()) {
      const t = f.q.replace(/[%,()]/g, ' ').trim();
      q = q.or(`contact_name.ilike.%${t}%,external_id.ilike.%${t}%,last_message_preview.ilike.%${t}%`);
    }
    const { data } = await q;
    setList(data || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const loadThread = useCallback(async (id: string) => {
    const { data } = await supabase.from('conversation_messages').select('*, profiles:sent_by(full_name)').eq('conversation_id', id).order('created_at').limit(300);
    setMsgs(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const t = setTimeout(loadList, f.q ? 300 : 0); return () => clearTimeout(t); }, [loadList, f.q]);

  // live updates
  useEffect(() => {
    let timer: any;
    const ch = supabase.channel('chats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => { clearTimeout(timer); timer = setTimeout(loadList, 400); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_messages' }, (p: any) => {
        if (p.new?.conversation_id && p.new.conversation_id === selId) loadThread(selId!);
      })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadList, loadThread, selId]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, selId]);

  const open = async (c: any) => {
    setSelId(c.id); setErr(''); setBody(''); setTpl((t) => ({ ...t, open: false }));
    loadThread(c.id);
    if (c.unread > 0) {
      await supabase.from('conversations').update({ unread: 0 }).eq('id', c.id);
      setList((l) => l.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
    }
  };

  const age = sel?.last_inbound_at ? Date.now() - new Date(sel.last_inbound_at).getTime() : Infinity;
  const waClosed = sel?.channel === 'whatsapp' && age > DAY;
  const dmTagged = (sel?.channel === 'facebook' || sel?.channel === 'instagram') && age > DAY;
  const dmClosed = (sel?.channel === 'facebook' || sel?.channel === 'instagram') && age > 7 * DAY;

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!sel || sending) return;
    const useTpl = tpl.open && tpl.name.trim();
    if (!useTpl && !body.trim()) return;
    setSending(true); setErr('');
    const res = await fetch('/api/inbox/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: sel.id, body: body.trim(),
        template: useTpl ? { name: tpl.name.trim(), language: tpl.language || 'en', params: tpl.params.split('|').map((s) => s.trim()).filter(Boolean) } : null,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) setErr(d.error || 'Not sent');
    else { setBody(''); setTpl((t) => ({ ...t, open: false })); }
    loadThread(sel.id);
  };

  const update = async (patch: any) => {
    if (!sel) return;
    const { error } = await supabase.from('conversations').update(patch).eq('id', sel.id);
    if (error) return alert(error.message);
    if (patch.branch_id !== undefined && sel.lead_id) await supabase.from('leads').update({ branch_id: patch.branch_id }).eq('id', sel.lead_id).is('branch_id', null);
    loadList();
  };

  const createLead = async () => {
    if (!sel) return;
    const { data, error } = await supabase.from('leads').insert({
      name: sel.contact_name || sel.external_id, phone: ['whatsapp', 'sms'].includes(sel.channel) ? sel.external_id : null,
      source: sel.channel, status: 'new', branch_id: sel.branch_id, message: sel.last_message_preview,
    }).select('id').single();
    if (error) return alert(error.message);
    await update({ lead_id: data.id });
  };

  const convert = async () => {
    if (!sel?.lead_id) return;
    const { data, error } = await supabase.rpc('convert_lead', { p_lead: sel.lead_id });
    if (error) return alert(error.message);
    await supabase.from('conversations').update({ patient_id: data }).eq('id', sel.id);
    loadList();
  };

  const totalUnread = list.reduce((s, c) => s + (c.unread || 0), 0);

  return (
    <div>
      <PageHeader title="Chats" subtitle="WhatsApp, Facebook, Instagram and SMS messages from every clinic, in one place."
        actions={role === 'admin' ? <button className="btn-secondary" onClick={() => setSetup(true)}><Settings2 size={16} /> Channels</button> : undefined} />

      <div className="card mb-4 flex flex-col gap-2 p-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setF({ ...f, channel: '' })} className={cn('rounded-lg px-3 py-1.5 text-xs font-bold', !f.channel ? 'bg-ink text-white' : 'bg-slate-100 text-ink-soft hover:text-ink')}>All</button>
          {CHANNELS.map((c) => (
            <button key={c} onClick={() => setF({ ...f, channel: c })} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold', f.channel === c ? 'bg-ink text-white' : 'bg-slate-100 text-ink-soft hover:text-ink')}>
              <ChannelDot channel={c} className="h-4 min-w-4" />{CHANNEL_META[c].label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap gap-2 lg:justify-end">
          <select className="input w-auto py-1.5" value={f.clinic} onChange={(e) => setF({ ...f, clinic: e.target.value })} aria-label="Clinic">
            <option value="">All clinics</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="input w-auto py-1.5" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
            <option value="open">Open</option><option value="closed">Closed</option><option value="">All</option>
          </select>
          <label className="flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 text-xs font-semibold ring-1 ring-slate-200">
            <input type="checkbox" className="accent-brand-600" checked={f.unread} onChange={(e) => setF({ ...f, unread: e.target.checked })} /> Unread{totalUnread ? ` (${totalUnread})` : ''}
          </label>
          <div className="relative min-w-[180px] flex-1 lg:max-w-[240px]">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input className="input py-1.5 pl-9" placeholder="Search name, number, text" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        {/* conversation list */}
        <div className={cn('card min-w-0 overflow-hidden lg:block', sel && 'hidden')}>
          <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {loading && <div className="flex justify-center py-12"><Spinner /></div>}
            {!loading && list.length === 0 && <Empty text="No chats yet. Connect WhatsApp, Facebook or Instagram under Channels." />}
            {list.map((c) => (
              <button key={c.id} onClick={() => open(c)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50', selId === c.id && 'bg-brand-50/60')}>
                <span className="relative">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-sm font-bold text-ink-soft">{who(c)[0]?.toUpperCase()}</span>
                  <ChannelDot channel={c.channel} className="absolute -bottom-1 -right-1 h-4 min-w-4 ring-2 ring-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('truncate text-sm', c.unread ? 'font-bold' : 'font-semibold')}>{who(c)}</p>
                    <span className="shrink-0 text-[11px] text-ink-muted">{when(c.last_message_at)}</span>
                  </div>
                  <p className={cn('truncate text-xs', c.unread ? 'text-ink' : 'text-ink-soft')}>{c.last_message_preview || '...'}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                    {c.branches?.name && <span className="truncate">{c.branches.name}</span>}
                    {c.patients ? <span className="rounded bg-emerald-50 px-1.5 font-semibold text-emerald-700">Patient</span>
                      : c.leads ? <span className="rounded bg-sky-50 px-1.5 font-semibold text-sky-700">Lead</span> : null}
                  </div>
                </div>
                {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{c.unread}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* thread */}
        <div className={cn('card flex min-w-0 flex-col', !sel && 'hidden lg:flex')}>
          {!sel ? <Empty text="Choose a chat." /> : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <button className="btn-ghost btn-sm lg:hidden" onClick={() => setSelId(null)} aria-label="Back"><ArrowLeft size={16} /></button>
                  <ChannelDot channel={sel.channel} className="h-7 min-w-7 text-[10px]" />
                  <div className="min-w-0">
                    <p className="truncate font-bold">
                      {sel.patients ? <Link href={`/admin/patients/${sel.patients.id}`} className="hover:text-brand-700">{who(sel)}</Link> : who(sel)}
                      {sel.patients?.mrn && <span className="ml-2 text-xs font-normal text-ink-muted">{sel.patients.mrn}</span>}
                    </p>
                    <p className="truncate text-xs text-ink-soft">
                      {CHANNEL_META[sel.channel]?.label} · {['whatsapp', 'sms'].includes(sel.channel) ? sel.external_id : `ID ${sel.external_id}`}
                      {sel.channel_accounts?.name ? ` · via ${sel.channel_accounts.name}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input w-auto py-1.5 text-xs" value={sel.branch_id || ''} onChange={(e) => update({ branch_id: e.target.value || null })} aria-label="Clinic">
                    <option value="">No clinic</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {!sel.patient_id && !sel.lead_id && <button className="btn-secondary btn-sm" onClick={createLead}><UserPlus size={14} /> Add as lead</button>}
                  {!sel.patient_id && sel.lead_id && <button className="btn-secondary btn-sm" onClick={convert}><UserPlus size={14} /> Make patient</button>}
                  {sel.patient_id && <button className="btn-secondary btn-sm" onClick={() => setBook(true)}><CalendarPlus size={14} /> Book</button>}
                  {sel.status === 'open'
                    ? <button className="btn-secondary btn-sm" onClick={() => update({ status: 'closed', unread: 0 })}><CheckCircle2 size={14} /> Close</button>
                    : <button className="btn-secondary btn-sm" onClick={() => update({ status: 'open' })}><RotateCcw size={14} /> Reopen</button>}
                </div>
              </div>

              {(sel.leads || sel.patients || sel.ad_referral) && (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs">
                  <span className="text-ink-muted">Source:</span>
                  <SourceBadge source={sel.patients?.source || sel.leads?.source || sel.channel} detail={sel.leads?.source_detail || sel.ad_referral?.headline || sel.ad_referral?.ad_title} />
                  {sel.leads && !sel.patients && <Badge tone="blue">Lead · {sel.leads.status}</Badge>}
                  {sel.ad_referral?.source_url && <a href={sel.ad_referral.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700">Ad <ExternalLink size={11} /></a>}
                </div>
              )}

              <div className="max-h-[56vh] min-h-[300px] flex-1 space-y-2 overflow-y-auto bg-slate-50/40 p-4">
                {msgs.map((m) => {
                  const out = m.direction === 'out';
                  return (
                    <div key={m.id} className={cn('flex', out ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                        out ? (m.status === 'failed' ? 'bg-rose-50 text-rose-900 ring-1 ring-rose-200' : 'bg-brand-600 text-white') : 'bg-white ring-1 ring-slate-200')}>
                        {m.media_url && (
                          m.media_type === 'image' && !m.media_url.startsWith('wa:')
                            ? <img src={m.media_url} alt="" className="mb-1 max-h-60 rounded-lg" />
                            : <a href={m.media_url.startsWith('wa:') ? `/api/inbox/media/${m.media_url.slice(3)}` : m.media_url} target="_blank" rel="noreferrer"
                                className={cn('mb-1 inline-flex items-center gap-1.5 text-xs font-semibold underline', out ? 'text-white' : 'text-brand-700')}>
                                <Paperclip size={12} /> Open {m.media_type || 'attachment'}
                              </a>
                        )}
                        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                        <p className={cn('mt-1 flex items-center gap-1 text-[10px]', out && m.status !== 'failed' ? 'text-brand-100' : 'text-ink-muted')}>
                          {m.automated && <><Bot size={11} /> Auto ·</>}
                          {out && !m.automated && m.profiles?.full_name && <>{m.profiles.full_name} ·</>}
                          {fmtDateTime(m.created_at)}
                          {out && m.status !== 'failed' && <> · {m.status}</>}
                        </p>
                        {m.status === 'failed' && <p className="mt-1 text-[11px] font-semibold text-rose-700">Not sent: {m.error}</p>}
                      </div>
                    </div>
                  );
                })}
                <div ref={end} />
              </div>

              <div className="border-t border-slate-100 p-3">
                {err && <div className="mb-2"><Alert>{err}</Alert></div>}
                {waClosed && (
                  <p className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> More than 24 hours since they last wrote. WhatsApp only allows an approved template now.
                    <button className="ml-auto shrink-0 font-bold underline" onClick={() => setTpl({ ...tpl, open: !tpl.open })}>{tpl.open ? 'Hide' : 'Use template'}</button>
                  </p>
                )}
                {dmTagged && !dmClosed && <p className="mb-2 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">More than 24 hours since they last wrote: the reply is sent as a human agent message (allowed up to 7 days).</p>}
                {dmClosed && <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">More than 7 days since they last wrote. Facebook and Instagram do not allow a reply until they message again.</p>}
                {tpl.open && (
                  <div className="mb-2 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
                    <input className="input py-2" placeholder="Template name (e.g. appointment_reminder)" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
                    <input className="input py-2" placeholder="Language (en)" value={tpl.language} onChange={(e) => setTpl({ ...tpl, language: e.target.value })} />
                    <input className="input py-2" placeholder="Values, separated by |" value={tpl.params} onChange={(e) => setTpl({ ...tpl, params: e.target.value })} />
                    <p className="text-[11px] text-ink-muted sm:col-span-3">Templates are created and approved in WhatsApp Manager. Values fill {'{{1}}'}, {'{{2}}'} ... in order. The text box below is saved in the chat as a note of what was sent.</p>
                  </div>
                )}
                <form onSubmit={send} className="flex gap-2">
                  <textarea className="input min-h-[44px]" rows={2} disabled={dmClosed}
                    placeholder={`Reply on ${CHANNEL_META[sel.channel]?.label}... (Enter to send, Shift+Enter for a new line)`}
                    value={body} onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                  <button className="btn-primary self-end" disabled={sending || dmClosed || (!body.trim() && !(tpl.open && tpl.name.trim())) || (waClosed && !(tpl.open && tpl.name.trim()))} aria-label="Send">
                    {sending ? <Spinner /> : <Send size={16} />}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>

      <ChannelSetup open={setup} onClose={() => setSetup(false)} />
      {sel?.patient_id && <NewAppointment open={book} onClose={() => setBook(false)} onSaved={() => setBook(false)} presetPatientId={sel.patient_id} />}
    </div>
  );
}

function ChannelSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (open && !s) fetch('/api/inbox/status').then((r) => r.json()).then(setS); }, [open, s]);
  const Row = ({ ok, label, hint }: { ok?: boolean; label: string; hint?: string }) => (
    <li className="flex items-start gap-2 text-sm">
      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', ok ? 'bg-emerald-500' : 'bg-slate-300')} />
      <span><span className="font-semibold">{label}</span>{hint && <span className="block text-xs text-ink-muted">{hint}</span>}</span>
    </li>
  );
  return (
    <Modal open={open} onClose={onClose} title="Chat channels" wide>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">Connection</p>
            {!s ? <Spinner /> : (
              <ul className="space-y-2">
                <Row ok={s.meta} label="Meta (WhatsApp, Facebook, Instagram)" hint="META_ACCESS_TOKEN" />
                <Row ok={s.metaWebhook} label="Meta webhook" hint="META_APP_SECRET + META_VERIFY_TOKEN" />
                <Row ok={s.twilioWhatsapp || s.twilioSms} label="Twilio (optional)" hint="WhatsApp or SMS through Twilio instead" />
              </ul>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">Webhook URLs</p>
            {s && <>
              <p className="text-xs text-ink-soft">Meta app &gt; Webhooks (WhatsApp, Page, Instagram):</p>
              <code className="mb-2 block break-all rounded bg-white px-2 py-1 text-xs ring-1 ring-slate-200">{s.metaWebhookUrl}</code>
              <p className="text-xs text-ink-soft">Twilio number &gt; "A message comes in":</p>
              <code className="block break-all rounded bg-white px-2 py-1 text-xs ring-1 ring-slate-200">{s.twilioWebhookUrl}</code>
            </>}
          </div>
        </div>
        <div>
          <p className="mb-1 font-bold">Numbers and pages per clinic</p>
          <p className="mb-3 text-xs text-ink-soft">Add each WhatsApp number, Facebook page and Instagram account and pick its clinic. Every chat that comes in on it is tagged with that clinic, and replies go out from the same number or page.</p>
          <ResourceManager embedded table="channel_accounts" title="Channels" select="*, branches(name)" orderBy={{ column: 'created_at', ascending: true }}
            columns={[
              { key: 'name', label: 'Name', render: (r) => <span className="flex items-center gap-2 font-semibold"><ChannelDot channel={r.channel} />{r.name}</span> },
              { key: 'account_id', label: 'ID / number', className: 'text-xs' },
              { key: 'clinic', label: 'Clinic', render: (r) => r.branches?.name || <span className="text-ink-muted">None</span> },
              { key: 'active', label: 'Active', render: (r) => (r.active ? 'Yes' : 'No'), hideOnMobile: true },
            ]}
            fields={[
              { name: 'channel', label: 'Channel', type: 'select', required: true, options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_META[c].label })) },
              { name: 'provider', label: 'Provider', type: 'select', options: [{ value: 'meta', label: 'Meta (Cloud API / Page)' }, { value: 'twilio', label: 'Twilio' }] },
              { name: 'name', label: 'Name (e.g. Gulberg WhatsApp)', required: true },
              { name: 'account_id', label: 'WhatsApp phone number ID / Page ID / Instagram ID / Twilio number', required: true, full: true },
              { name: 'page_id', label: 'Instagram only: linked Facebook Page ID' },
              { name: 'branch_id', label: 'Clinic', type: 'select', optionsFrom: { table: 'branches', select: 'id, name', label: (r: any) => r.name, order: 'name' } },
              { name: 'active', label: 'Active', type: 'checkbox' },
            ]}
            defaults={{ provider: 'meta', active: true, channel: 'whatsapp' }}
          />
        </div>
      </div>
    </Modal>
  );
}
