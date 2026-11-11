'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Clock, Pencil, Play, Plus, RotateCcw, Send, Trash2, X, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Badge, Modal, PageHeader, Spinner, Tabs } from '@/components/ui';
import { StatCard } from '@/components/ui/StatCard';
import ResourceManager from '@/components/admin/ResourceManager';
import { ChannelDot } from '@/components/admin/ChannelBadge';
import {
  CATEGORIES, CHANNEL_LABEL, SAMPLE_VARS, SOURCES, TRIGGERS, VAR_HELP, describeTiming, fill, ruleCategory,
  type Rule, type Trigger,
} from '@/lib/automation-core';
import { cn, fmtDateTime, titleCase } from '@/lib/utils';

const BLANK: Rule = { name: '', trigger: 'appointment_booked', enabled: true, channel: 'auto', delay_minutes: 0, conditions: {}, template: '', wa_language: 'en' };
const UNITS = [{ v: 1, l: 'minutes' }, { v: 60, l: 'hours' }, { v: 1440, l: 'days' }];

function splitDelay(d: number) {
  const a = Math.abs(d);
  const unit = a && a % 1440 === 0 ? 1440 : a && a % 60 === 0 ? 60 : 1;
  return { n: a / unit, unit, before: d < 0 };
}

export default function Automations() {
  const supabase = createClient();
  const [tab, setTab] = useState('rules');
  const [rules, setRules] = useState<Rule[]>([]);
  const [stats, setStats] = useState({ sent: 0, pending: 0, failed: 0, skipped: 0 });
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Rule | null>(null);
  const [jobStatus, setJobStatus] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const [{ data }, sent, pending, failed, skipped] = await Promise.all([
      supabase.from('automations').select('*').order('created_at'),
      supabase.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('processed_at', since),
      supabase.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('processed_at', since),
      supabase.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'skipped').gte('processed_at', since),
    ]);
    setRules((data || []) as Rule[]);
    setStats({ sent: sent.count || 0, pending: pending.count || 0, failed: failed.count || 0, skipped: skipped.count || 0 });
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r: Rule) => {
    setRules((l) => l.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)));
    const { error } = await supabase.from('automations').update({ enabled: !r.enabled, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { alert(error.message); load(); }
  };

  const grouped = useMemo(() => CATEGORIES.map((c) => ({ c, items: rules.filter((r) => ruleCategory(r) === c) })).filter((g) => g.items.length), [rules]);

  return (
    <div>
      <PageHeader title="Automations" subtitle="Messages and alerts that send themselves: confirmations, reminders, chat replies, follow-ups and more."
        actions={<button className="btn-primary" onClick={() => setEdit({ ...BLANK })}><Plus size={16} /> New automation</button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Sent (24h)" value={stats.sent} icon={<Send size={20} />} />
        <StatCard label="Waiting to send" value={stats.pending} icon={<Clock size={20} />} tone="sky" />
        <StatCard label="Skipped (24h)" value={stats.skipped} hint="Rule did not apply" icon={<X size={20} />} tone="amber" />
        <StatCard label="Failed (24h)" value={stats.failed} icon={<Zap size={20} />} tone="rose" />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'rules', label: 'Rules' }, { id: 'activity', label: 'Activity' }, { id: 'setup', label: 'Setup' }]} />

      {tab === 'rules' && (loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="space-y-6">
          {grouped.map(({ c, items }) => (
            <div key={c}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">{c}</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((r) => (
                  <div key={r.id} className={cn('card flex gap-4 p-4', !r.enabled && 'opacity-70')}>
                    <button onClick={() => toggle(r)} role="switch" aria-checked={r.enabled} aria-label={`Turn ${r.name} ${r.enabled ? 'off' : 'on'}`}
                      className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', r.enabled ? 'bg-brand-600' : 'bg-slate-300')}>
                      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', r.enabled ? 'left-[22px]' : 'left-0.5')} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold">{r.name}</p>
                        <button className="btn-ghost btn-sm -mr-2 -mt-1" onClick={() => setEdit(r)} aria-label="Edit"><Pencil size={14} /></button>
                      </div>
                      {r.description && <p className="text-xs text-ink-soft">{r.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge tone="blue"><Clock size={11} className="mr-1" />{describeTiming(r.trigger, r.delay_minutes)}</Badge>
                        <Badge tone={r.channel === 'staff' ? 'violet' : 'gray'}>{CHANNEL_LABEL[r.channel]}</Badge>
                        {r.conditions?.first_message_only && <Badge>First message only</Badge>}
                        {r.conditions?.outside_hours && <Badge>Outside {r.conditions.outside_hours.start} to {r.conditions.outside_hours.end}</Badge>}
                        {r.conditions?.exclude_sources?.length ? <Badge>Not from {r.conditions.exclude_sources.map(titleCase).join(', ')}</Badge> : null}
                        {r.conditions?.sources?.length ? <Badge>Only {r.conditions.sources.map(titleCase).join(', ')}</Badge> : null}
                        {r.wa_template && <Badge tone="green">WA template</Badge>}
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-ink-muted">{r.template}</p>
                      <p className="mt-1 text-[11px] text-ink-muted">{r.run_count ? `Sent ${r.run_count} times · last ${fmtDateTime(r.last_run_at)}` : 'Not sent yet'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === 'activity' && (
        <>
          <select className="input mb-4 sm:max-w-xs" value={jobStatus} onChange={(e) => setJobStatus(e.target.value)} aria-label="Status">
            <option value="">All</option>{['pending', 'sent', 'skipped', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <ResourceManager embedded table="automation_jobs" title="Activity" reloadKey={reloadKey} filters={{ status: jobStatus }}
            select="*, automations(name), patients(first_name, last_name), leads(name), conversations(contact_name, external_id, channel)"
            canCreate={false} canEdit={false} canDelete={false} searchColumns={['recipient', 'result']}
            columns={[
              { key: 'run_at', label: 'When', render: (r) => <div className="text-xs"><p className="font-semibold">{fmtDateTime(r.processed_at || r.run_at)}</p>{r.status === 'pending' && <p className="text-ink-muted">scheduled</p>}</div> },
              { key: 'rule', label: 'Automation', render: (r) => <span className="font-semibold">{r.automations?.name}</span> },
              { key: 'who', label: 'For', render: (r) => <div className="text-xs"><p className="font-semibold">{r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : r.leads?.name || r.conversations?.contact_name || r.conversations?.external_id || '-'}</p>{r.recipient && <p className="text-ink-muted">{r.recipient}</p>}</div> },
              { key: 'channel', label: 'Channel', hideOnMobile: true, render: (r) => r.channel ? <span className="inline-flex items-center gap-1.5 text-xs">{r.channel === 'conversation' && r.conversations && <ChannelDot channel={r.conversations.channel} />}{CHANNEL_LABEL[r.channel] || r.channel}</span> : '-' },
              { key: 'status', label: 'Status', render: (r) => <div><Badge tone={({ sent: 'green', failed: 'red', pending: 'blue', skipped: 'gray', cancelled: 'gray' } as any)[r.status]}>{titleCase(r.status)}</Badge>{r.result && <p className="mt-1 max-w-[260px] whitespace-normal text-[11px] text-ink-muted">{r.result}</p>}</div> },
            ]}
            rowActions={(r, reload) => (
              <>
                {r.status === 'pending' && <button className="btn-ghost btn-sm" onClick={async () => { await supabase.from('automation_jobs').update({ status: 'cancelled', result: 'Cancelled by staff', processed_at: new Date().toISOString() }).eq('id', r.id); reload(); load(); }}><X size={14} /> Cancel</button>}
                {r.status === 'failed' && <button className="btn-ghost btn-sm" onClick={async () => { await supabase.from('automation_jobs').update({ status: 'pending', attempts: 0, run_at: new Date().toISOString() }).eq('id', r.id); reload(); load(); }}><RotateCcw size={14} /> Retry</button>}
              </>
            )}
          />
        </>
      )}

      {tab === 'setup' && <Setup onRan={() => { load(); setReloadKey((k) => k + 1); }} />}

      {edit && <Editor rule={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function Editor({ rule, onClose, onSaved }: { rule: Rule; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [r, setR] = useState<Rule>({ ...rule, conditions: { ...(rule.conditions || {}) } });
  const init = splitDelay(rule.delay_minutes);
  const [n, setN] = useState(init.n);
  const [unit, setUnit] = useState(init.unit);
  const [before, setBefore] = useState(init.before || (!rule.id && TRIGGERS[rule.trigger].timing === 'before'));
  const [clinics, setClinics] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [adv, setAdv] = useState(!!rule.wa_template);

  useEffect(() => { supabase.from('branches').select('id, name').eq('active', true).order('name').then(({ data }) => setClinics(data || [])); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = TRIGGERS[r.trigger];
  const delay = (before && t.timing === 'before' ? -1 : 1) * (Number(n) || 0) * unit;
  const c = r.conditions || {};
  const setC = (patch: any) => setR({ ...r, conditions: { ...c, ...patch } });
  const insertVar = (v: string) => setR({ ...r, template: `${r.template}${r.template && !r.template.endsWith(' ') ? ' ' : ''}{${v}}` });
  const toggleList = (key: 'sources' | 'exclude_sources', s: string) => {
    const cur = new Set(c[key] || []);
    cur.has(s) ? cur.delete(s) : cur.add(s);
    setC({ [key]: Array.from(cur) });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const cond: any = { ...c };
    Object.keys(cond).forEach((k) => (cond[k] === '' || cond[k] === null || (Array.isArray(cond[k]) && !cond[k].length) || cond[k] === false) && delete cond[k]);
    const payload = {
      name: r.name, description: r.description || null, trigger: r.trigger, enabled: r.enabled, channel: r.channel, delay_minutes: delay,
      conditions: cond, subject: r.subject || null, template: r.template, wa_template: r.wa_template || null, wa_language: r.wa_language || 'en',
      wa_params: r.wa_params || null, notify_to: r.notify_to || null, marketing: !!r.marketing, updated_at: new Date().toISOString(),
    };
    const res = r.id ? await supabase.from('automations').update(payload).eq('id', r.id) : await supabase.from('automations').insert(payload);
    setBusy(false);
    if (res.error) return setErr(res.error.message);
    onSaved();
  };

  const remove = async () => {
    if (!r.id || !confirm('Delete this automation? Its history is deleted too.')) return;
    const { error } = await supabase.from('automations').delete().eq('id', r.id);
    if (error) return alert(error.message);
    onSaved();
  };

  const test = async () => {
    setTestMsg('Sending...');
    const res = await fetch('/api/automations/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule: r, to: testTo }) });
    const d = await res.json().catch(() => ({}));
    setTestMsg(res.ok ? 'Test sent.' : d.error || 'Not sent');
  };

  return (
    <Modal open onClose={onClose} title={r.id ? 'Edit automation' : 'New automation'} wide>
      <form onSubmit={save} className="space-y-5">
        {err && <Alert>{err}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="label">Name *</span><input className="input" required value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></label>
          <label className="block"><span className="label">When this happens</span>
            <select className="input" value={r.trigger} disabled={!!r.key} onChange={(e) => { const tr = e.target.value as Trigger; setR({ ...r, trigger: tr }); setBefore(TRIGGERS[tr].timing === 'before'); }}>
              {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select></label>
          <div>
            <span className="label">Send</span>
            <div className="flex gap-2">
              <input type="number" min={0} className="input w-20" value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Amount" />
              <select className="input w-28" value={unit} onChange={(e) => setUnit(Number(e.target.value))} aria-label="Unit">{UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}</select>
              <select className="input flex-1" value={before ? 'before' : 'after'} onChange={(e) => setBefore(e.target.value === 'before')} disabled={t.timing !== 'before'} aria-label="Before or after">
                <option value="after">after</option>{t.timing === 'before' && <option value="before">before</option>}
              </select>
            </div>
            <p className="mt-1 text-xs text-ink-muted">{describeTiming(r.trigger, delay)}</p>
          </div>
          <label className="block"><span className="label">Send by</span>
            <select className="input" value={r.channel} onChange={(e) => setR({ ...r, channel: e.target.value as any })}>
              <option value="auto">Best available (chat reply, WhatsApp, SMS, email)</option>
              <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option>
              <option value="staff">Alert to staff</option>
            </select></label>
          <label className="block"><span className="label">Only for clinic</span>
            <select className="input" value={c.branch_id || ''} onChange={(e) => setC({ branch_id: e.target.value || null })}>
              <option value="">All clinics</option>{clinics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          {r.channel === 'staff' && (
            <label className="block sm:col-span-2"><span className="label">Staff phone or email to notify *</span>
              <input className="input" required placeholder="+923001234567 or owner@clinic.com" value={r.notify_to || ''} onChange={(e) => setR({ ...r, notify_to: e.target.value })} /></label>
          )}
        </div>

        <div>
          <span className="label">Message</span>
          <textarea className="input min-h-[110px]" required value={r.template} onChange={(e) => setR({ ...r, template: e.target.value })} />
          <div className="mt-2 flex flex-wrap gap-1">
            {t.vars.map((v) => (
              <button type="button" key={v} onClick={() => insertVar(v)} title={VAR_HELP[v]} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-ink-soft hover:bg-brand-50 hover:text-brand-700">{`{${v}}`}</button>
            ))}
          </div>
          {r.template && (
            <div className="mt-3 rounded-xl bg-emerald-50/60 p-3 text-sm ring-1 ring-emerald-100">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">Preview</p>
              <p className="whitespace-pre-wrap">{fill(r.template, SAMPLE_VARS)}</p>
            </div>
          )}
        </div>
        {(r.channel === 'email' || r.channel === 'auto' || r.channel === 'staff') && (
          <label className="block"><span className="label">Email subject</span><input className="input" value={r.subject || ''} onChange={(e) => setR({ ...r, subject: e.target.value })} /></label>
        )}

        <div className="rounded-xl bg-slate-50 p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-soft">Conditions</p>
          <div className="space-y-3 text-sm">
            {(r.trigger === 'message_received') && (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={!!c.first_message_only} onChange={(e) => setC({ first_message_only: e.target.checked })} /> Only the first message of a new chat</label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={!!c.outside_hours} onChange={(e) => setC({ outside_hours: e.target.checked ? { start: '09:00', end: '21:00' } : null })} /> Only when the clinic is closed. Open from</label>
                  {c.outside_hours && <>
                    <input type="time" className="input w-auto py-1" value={c.outside_hours.start} onChange={(e) => setC({ outside_hours: { ...c.outside_hours!, start: e.target.value } })} />
                    <span>to</span>
                    <input type="time" className="input w-auto py-1" value={c.outside_hours.end} onChange={(e) => setC({ outside_hours: { ...c.outside_hours!, end: e.target.value } })} />
                  </>}
                </div>
              </>
            )}
            {r.trigger === 'recall' && (
              <label className="flex items-center gap-2">Days since the last visit <input type="number" min={7} className="input w-24 py-1" value={c.days ?? 180} onChange={(e) => setC({ days: Number(e.target.value) })} /></label>
            )}
            {r.trigger !== 'low_stock' && (
              <>
                <div><p className="mb-1 text-xs font-semibold text-ink-soft">Only when the source is (leave empty for any)</p>
                  <div className="flex flex-wrap gap-1">{SOURCES.map((s) => <button type="button" key={s} onClick={() => toggleList('sources', s)} className={cn('rounded-lg px-2 py-1 text-xs font-semibold ring-1', (c.sources || []).includes(s) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-soft ring-slate-200')}>{titleCase(s)}</button>)}</div>
                </div>
                <div><p className="mb-1 text-xs font-semibold text-ink-soft">Never when the source is</p>
                  <div className="flex flex-wrap gap-1">{SOURCES.map((s) => <button type="button" key={s} onClick={() => toggleList('exclude_sources', s)} className={cn('rounded-lg px-2 py-1 text-xs font-semibold ring-1', (c.exclude_sources || []).includes(s) ? 'bg-rose-600 text-white ring-rose-600' : 'bg-white text-ink-soft ring-slate-200')}>{titleCase(s)}</button>)}</div>
                </div>
              </>
            )}
            {r.channel !== 'staff' && <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={!!r.marketing} onChange={(e) => setR({ ...r, marketing: e.target.checked })} /> Marketing message (skip patients who opted out)</label>}
          </div>
        </div>

        {r.channel !== 'staff' && (
          <div>
            <button type="button" className="text-xs font-bold text-brand-700" onClick={() => setAdv(!adv)}>{adv ? 'Hide' : 'Show'} WhatsApp template settings</button>
            {adv && (
              <div className="mt-2 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
                <p className="text-xs text-ink-soft sm:col-span-3">WhatsApp (Meta) only lets you start a conversation, or write more than 24 hours after the person&apos;s last message, with a template approved in WhatsApp Manager. Reminders, birthdays and recalls need one. Chat replies do not.</p>
                <label className="block"><span className="label">Template name</span><input className="input" placeholder="appointment_reminder" value={r.wa_template || ''} onChange={(e) => setR({ ...r, wa_template: e.target.value })} /></label>
                <label className="block"><span className="label">Language</span><input className="input" placeholder="en" value={r.wa_language || ''} onChange={(e) => setR({ ...r, wa_language: e.target.value })} /></label>
                <label className="block"><span className="label">Values for {'{{1}}, {{2}}'}...</span><input className="input" placeholder="first_name,doctor,date,time" value={r.wa_params || ''} onChange={(e) => setR({ ...r, wa_params: e.target.value })} /></label>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-slate-200 p-3 sm:flex-row sm:items-center">
          <span className="text-xs font-semibold text-ink-soft">Send a test with sample values to</span>
          <input className="input flex-1 py-1.5" placeholder="+923001234567 or you@clinic.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button type="button" className="btn-secondary btn-sm" disabled={!testTo.trim() || !r.template.trim()} onClick={test}><Send size={14} /> Test</button>
          {testMsg && <span className="text-xs text-ink-soft">{testMsg}</span>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} /> On</label>
          <div className="flex gap-2">
            {r.id && !r.key && <button type="button" className="btn-ghost text-rose-600" onClick={remove}><Trash2 size={16} /></button>}
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy && <Spinner />} Save</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Setup({ onRan }: { onRan: () => void }) {
  const [s, setS] = useState<any>(null);
  const [run, setRun] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: '' });
  useEffect(() => { fetch('/api/inbox/status').then((r) => r.json()).then(setS); }, []);
  const runNow = async () => {
    setRun({ busy: true, msg: '' });
    const res = await fetch('/api/automations/run', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setRun({ busy: false, msg: res.ok ? `Done: ${d.sent} sent, ${d.skipped} skipped, ${d.failed} failed (${d.scanned} new date-based jobs).` : d.error || 'Failed' });
    onRan();
  };
  const Row = ({ ok, label, hint }: { ok?: boolean; label: string; hint: string }) => (
    <li className="flex items-start gap-3 py-2">
      <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', ok ? 'bg-emerald-500' : 'bg-slate-300')} />
      <div><p className="text-sm font-semibold">{label} <span className={cn('text-xs font-normal', ok ? 'text-emerald-700' : 'text-ink-muted')}>{ok ? 'connected' : 'not set'}</span></p><p className="text-xs text-ink-muted">{hint}</p></div>
    </li>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h3 className="mb-2 flex items-center gap-2 font-bold"><Bot size={18} className="text-brand-600" /> Run automations now</h3>
        <p className="mb-4 text-sm text-ink-soft">Sends everything that is due. This also runs by itself every few minutes once the scheduler is set (below).</p>
        <button className="btn-primary" onClick={runNow} disabled={run.busy}>{run.busy ? <Spinner /> : <Play size={16} />} Run now</button>
        {run.msg && <p className="mt-3 text-sm">{run.msg}</p>}
        <div className="mt-6 border-t border-slate-100 pt-4 text-sm">
          <p className="mb-1 font-bold">Scheduler</p>
          <p className="text-ink-soft">Call this address every 5 to 10 minutes with your <code className="rounded bg-slate-100 px-1">CRON_SECRET</code>:</p>
          <code className="my-2 block break-all rounded bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">{s?.cronUrl || '...'}</code>
          <p className="text-xs text-ink-muted">Easiest: run <code>supabase/09_automation_scheduler.sql</code> in Supabase (uses pg_cron, works on any hosting plan). On Vercel Pro you can use Vercel Cron instead.</p>
        </div>
      </div>
      <div className="card p-5">
        <h3 className="mb-2 font-bold">Channels</h3>
        {!s ? <Spinner /> : (
          <ul className="divide-y divide-slate-100">
            <Row ok={s.meta} label="WhatsApp / Facebook / Instagram (Meta)" hint="META_ACCESS_TOKEN. Add each clinic's number and page under Chats > Channels." />
            <Row ok={s.twilioWhatsapp} label="WhatsApp through Twilio" hint="Optional alternative: TWILIO_WHATSAPP_FROM" />
            <Row ok={s.twilioSms} label="SMS (Twilio)" hint="TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER" />
            <Row ok={s.email} label="Email (Resend)" hint="RESEND_API_KEY, EMAIL_FROM" />
            <Row ok={s.cron} label="Cron secret" hint="CRON_SECRET protects the scheduler address" />
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-muted">"Best available" sends a chat reply when the person wrote to you, otherwise WhatsApp, then SMS, then email. Anything that cannot be sent is listed under Activity with the reason.</p>
      </div>
    </div>
  );
}
