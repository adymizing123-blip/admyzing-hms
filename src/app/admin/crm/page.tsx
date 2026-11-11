'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Phone, UserPlus, Check, MessageCircle, Send, MessagesSquare } from 'lucide-react';
import { SourceBadge, SOURCE_OPTIONS, ChannelDot } from '@/components/admin/ChannelBadge';
import SendMessage, { type Recipient } from '@/components/admin/SendMessage';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { PageHeader, Tabs, StatusBadge, Badge } from '@/components/ui';
import { patientOption } from '@/lib/fields';
import { fmtDate, fmtDateTime, titleCase } from '@/lib/utils';

const AUDIENCES = [
  { value: 'all_patients', label: 'All patients' },
  { value: 'recent_patients', label: 'Patients seen in last 90 days' },
  { value: 'all_leads', label: 'All open leads' },
  { value: 'new_leads', label: 'New leads only' },
];

const sources = SOURCE_OPTIONS;
const clinicOption = { table: 'branches', select: 'id, name', label: (r: any) => r.name, order: 'name' };

export default function CRM() {
  const router = useRouter();
  const [tab, setTab] = useState('leads');
  const [leadStatus, setLeadStatus] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [leadClinic, setLeadClinic] = useState('');
  const [clinics, setClinics] = useState<any[]>([]);
  useEffect(() => { createClient().from('branches').select('id, name').eq('active', true).order('name').then(({ data }) => setClinics(data || [])); }, []);
  const [fuStatus, setFuStatus] = useState('pending');
  const [msgTo, setMsgTo] = useState<{ to: Recipient; channel?: any; body?: string; purpose?: string; after?: () => void } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const convert = async (lead: any, reload: () => void) => {
    // keeps the lead's source, ad and clinic on the patient, and links their chats
    const { data, error } = await createClient().rpc('convert_lead', { p_lead: lead.id });
    if (error) return alert(error.message);
    reload();
    router.push(`/admin/patients/${data}`);
  };

  return (
    <div>
      <PageHeader title="CRM" subtitle="Leads, follow-up reminders, campaigns and patient feedback." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'leads', label: 'Leads' }, { id: 'followups', label: 'Follow-ups' }, { id: 'campaigns', label: 'Campaigns' }, { id: 'messages', label: 'Message log' }, { id: 'feedback', label: 'Feedback' }]} />

      {tab === 'leads' && (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <select className="input sm:max-w-[200px]" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>{['new', 'contacted', 'qualified', 'converted', 'lost'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
            <select className="input sm:max-w-[200px]" value={leadSource} onChange={(e) => setLeadSource(e.target.value)} aria-label="Source">
              <option value="">All sources</option>{sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select className="input sm:max-w-[200px]" value={leadClinic} onChange={(e) => setLeadClinic(e.target.value)} aria-label="Clinic">
              <option value="">All clinics</option>{clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <ResourceManager embedded table="leads" title="Leads" filters={{ status: leadStatus, source: leadSource, branch_id: leadClinic }} searchColumns={['name', 'phone', 'email', 'interest', 'source_detail']}
            select="*, branches(name), conversations(id, channel)"
            columns={[
              { key: 'name', label: 'Lead', render: (r) => <div><p className="font-semibold">{r.name}</p><p className="text-xs text-ink-muted">{r.interest || r.message?.slice(0, 60)}</p></div> },
              { key: 'contact', label: 'Contact', render: (r) => <div className="text-xs">{r.phone && <p>{r.phone}</p>}{r.email && <p className="text-ink-soft">{r.email}</p>}</div> },
              { key: 'source', label: 'Source', render: (r) => <div className="max-w-[220px]"><SourceBadge source={r.source} detail={r.source_detail} /></div>, hideOnMobile: true },
              { key: 'clinic', label: 'Clinic', render: (r) => r.branches?.name || <span className="text-ink-muted">-</span>, hideOnMobile: true },
              { key: 'created_at', label: 'Received', render: (r) => fmtDate(r.created_at), hideOnMobile: true },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
            rowActions={(r, reload) => (
              <>
                {r.conversations?.[0] && <Link href="/admin/chats" className="btn-ghost btn-sm" aria-label="Open chat" title="Open chat"><ChannelDot channel={r.conversations[0].channel} className="h-4 min-w-4" /><MessagesSquare size={14} /></Link>}
                {r.phone && <a href={`tel:${r.phone}`} className="btn-ghost btn-sm" aria-label="Call"><Phone size={14} /></a>}
                {(r.phone || r.email) && <button className="btn-ghost btn-sm" aria-label="Message" onClick={() => setMsgTo({ to: { name: r.name, phone: r.phone, email: r.email, lead_id: r.id } })}><MessageCircle size={14} /></button>}
                {r.status !== 'converted' && <button className="btn-secondary btn-sm" onClick={() => convert(r, reload)}><UserPlus size={14} /> Convert</button>}
              </>
            )}
            fields={[
              { name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
              { name: 'source', label: 'Source', type: 'select', options: sources }, { name: 'source_detail', label: 'Ad / campaign name' },
              { name: 'branch_id', label: 'Clinic', type: 'select', optionsFrom: clinicOption }, { name: 'interest', label: 'Interested in' },
              { name: 'status', label: 'Status', type: 'select', options: ['new', 'contacted', 'qualified', 'converted', 'lost'].map((v) => ({ value: v, label: titleCase(v) })) },
              { name: 'message', label: 'Message', type: 'textarea' }, { name: 'notes', label: 'Internal notes', type: 'textarea' },
            ]}
            defaults={{ status: 'new', source: 'phone' }}
          />
        </>
      )}

      {tab === 'followups' && (
        <>
          <select className="input mb-4 sm:max-w-xs" value={fuStatus} onChange={(e) => setFuStatus(e.target.value)}>
            <option value="">All</option><option value="pending">Pending</option><option value="done">Done</option><option value="skipped">Skipped</option>
          </select>
          <ResourceManager embedded table="follow_ups" title="Follow-ups" filters={{ status: fuStatus }} select="*, patients(first_name, last_name, phone, email), leads(name, phone, email)" orderBy={{ column: 'due_date', ascending: true }}
            columns={[
              { key: 'due_date', label: 'Due', render: (r) => <span className={r.status === 'pending' && new Date(r.due_date) < new Date(new Date().toDateString()) ? 'font-semibold text-rose-600' : ''}>{fmtDate(r.due_date)}</span> },
              { key: 'who', label: 'Person', render: (r) => <div><p className="font-semibold">{r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : r.leads?.name}</p><p className="text-xs text-ink-muted">{r.patients?.phone || r.leads?.phone}</p></div> },
              { key: 'channel', label: 'Channel', render: (r) => <Badge tone="blue">{titleCase(r.channel)}</Badge> },
              { key: 'message', label: 'Message', hideOnMobile: true, className: 'whitespace-normal max-w-xs' },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
            reloadKey={reloadKey}
            rowActions={(r, reload) => r.status === 'pending' ? (
              <>
                {r.channel !== 'call' && (
                  <button className="btn-primary btn-sm" onClick={() => setMsgTo({
                    to: r.patients ? { name: `${r.patients.first_name} ${r.patients.last_name}`, phone: r.patients.phone, email: r.patients.email, patient_id: r.patient_id } : { name: r.leads?.name, phone: r.leads?.phone, email: r.leads?.email, lead_id: r.lead_id },
                    channel: r.channel, body: r.message || '', purpose: 'follow_up',
                    after: async () => { await createClient().from('follow_ups').update({ status: 'done' }).eq('id', r.id); reload(); },
                  })}><Send size={14} /> Send</button>
                )}
                <button className="btn-secondary btn-sm" onClick={async () => { await createClient().from('follow_ups').update({ status: 'done' }).eq('id', r.id); reload(); }}><Check size={14} /> Done</button>
              </>
            ) : null}
            fields={[
              { name: 'patient_id', label: 'Patient', type: 'select', optionsFrom: patientOption },
              { name: 'lead_id', label: 'Or lead', type: 'select', optionsFrom: { table: 'leads', select: 'id, name', label: (r: any) => r.name, order: 'name' } },
              { name: 'due_date', label: 'Due date', type: 'date', required: true },
              { name: 'channel', label: 'Channel', type: 'select', options: ['call', 'sms', 'email', 'whatsapp'].map((v) => ({ value: v, label: titleCase(v) })) },
              { name: 'message', label: 'Message / purpose', type: 'textarea' },
              { name: 'status', label: 'Status', type: 'select', options: ['pending', 'done', 'skipped'].map((v) => ({ value: v, label: titleCase(v) })) },
            ]}
            defaults={{ status: 'pending', channel: 'call' }}
          />
        </>
      )}

      {tab === 'campaigns' && (
        <>
          <p className="mb-4 text-sm text-ink-soft">Use <code className="rounded bg-slate-100 px-1">{'{first_name}'}</code>, <code className="rounded bg-slate-100 px-1">{'{hospital}'}</code> and <code className="rounded bg-slate-100 px-1">{'{phone}'}</code> in the message. Patients who opted out of marketing are skipped automatically.</p>
          <ResourceManager embedded table="campaigns" title="Campaigns" searchColumns={['name']} reloadKey={reloadKey}
            columns={[
              { key: 'name', label: 'Campaign', render: (r) => <span className="font-semibold">{r.name}</span> },
              { key: 'channel', label: 'Channel', render: (r) => <Badge tone="blue">{titleCase(r.channel)}</Badge> },
              { key: 'audience', label: 'Audience', render: (r) => AUDIENCES.find((a) => a.value === r.audience)?.label || r.audience, hideOnMobile: true },
              { key: 'result', label: 'Result', render: (r) => r.status === 'sent' ? <span className="text-xs">{r.sent_count} sent{r.failed_count ? ` · ${r.failed_count} not delivered` : ''}</span> : '-', hideOnMobile: true },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
            rowActions={(r, reload) => r.status !== 'sent' ? (
              <button className="btn-primary btn-sm" onClick={async () => {
                if (!confirm(`Send "${r.name}" now to ${AUDIENCES.find((a) => a.value === r.audience)?.label || r.audience}?`)) return;
                const res = await fetch('/api/campaigns/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaign_id: r.id }) });
                const d = await res.json();
                alert(res.ok ? `Sent: ${d.sent} · Failed: ${d.failed} · Skipped (no contact or not configured): ${d.skipped}` : d.error);
                reload();
              }}><Send size={14} /> Send now</button>
            ) : null}
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'channel', label: 'Channel', type: 'select', options: ['email', 'sms', 'whatsapp'].map((v) => ({ value: v, label: titleCase(v) })) },
              { name: 'audience', label: 'Audience', type: 'select', options: AUDIENCES, required: true },
              { name: 'subject', label: 'Email subject' },
              { name: 'scheduled_at', label: 'Planned send date (for your calendar)', type: 'datetime' },
              { name: 'message', label: 'Message', type: 'textarea', required: true },
            ]}
            defaults={{ status: 'draft', channel: 'email', audience: 'all_patients' }}
          />
        </>
      )}

      {tab === 'messages' && (
        <ResourceManager embedded table="message_log" title="Messages" select="*, patients(first_name, last_name), leads(name)" canCreate={false} canEdit={false} canDelete={false}
          searchColumns={['to_address', 'body']}
          columns={[
            { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
            { key: 'who', label: 'To', render: (r) => <div><p className="font-semibold">{r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : r.leads?.name || '-'}</p><p className="text-xs text-ink-muted">{r.to_address}</p></div> },
            { key: 'channel', label: 'Channel', render: (r) => <Badge tone="blue">{r.channel === 'sms' ? 'SMS' : titleCase(r.channel)}</Badge> },
            { key: 'purpose', label: 'Type', render: (r) => titleCase(r.purpose), hideOnMobile: true },
            { key: 'body', label: 'Message', className: 'whitespace-normal max-w-sm text-xs', hideOnMobile: true },
            { key: 'status', label: 'Status', render: (r) => <div><Badge tone={r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : 'gray'}>{titleCase(r.status)}</Badge>{r.error && <p className="mt-1 max-w-[200px] whitespace-normal text-[11px] text-ink-muted">{r.error}</p>}</div> },
          ]}
        />
      )}

      {tab === 'feedback' && (
        <ResourceManager embedded table="feedback" title="Feedback" select="*, patients(first_name, last_name)"
          columns={[
            { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
            { key: 'patient', label: 'Patient', render: (r) => r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : 'Anonymous' },
            { key: 'rating', label: 'Rating', render: (r) => <span className="text-amber-500">{'★'.repeat(r.rating || 0)}<span className="text-slate-200">{'★'.repeat(5 - (r.rating || 0))}</span></span> },
            { key: 'comment', label: 'Comment', className: 'whitespace-normal max-w-sm' },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          fields={[
            { name: 'patient_id', label: 'Patient', type: 'select', optionsFrom: patientOption },
            { name: 'rating', label: 'Rating (1 to 5)', type: 'number' },
            { name: 'comment', label: 'Comment', type: 'textarea' },
            { name: 'status', label: 'Status', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }] },
          ]}
          defaults={{ status: 'open' }}
        />
      )}
      <SendMessage open={!!msgTo} onClose={() => setMsgTo(null)} to={msgTo?.to || null} defaultChannel={msgTo?.channel} defaultBody={msgTo?.body} purpose={msgTo?.purpose}
        onSent={() => { msgTo?.after?.(); setReloadKey((k) => k + 1); }} />
    </div>
  );
}
