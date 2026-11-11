'use client';
import { useEffect, useState } from 'react';
import { MessageSquare, Mail, MessageCircle } from 'lucide-react';
import { Modal, Alert, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import { whatsappLink } from '@/lib/phone';

export type Recipient = { name: string; phone?: string | null; email?: string | null; patient_id?: string; lead_id?: string };

let configCache: Promise<{ sms: boolean; whatsapp: boolean; email: boolean }> | null = null;
export const getMessagingConfig = () => {
  if (!configCache) configCache = fetch('/api/messages').then((r) => (r.ok ? r.json() : { sms: false, whatsapp: false, email: false }));
  return configCache;
};

/** Shared "send SMS / WhatsApp / email" dialog used in CRM, patient records and follow-ups. */
export default function SendMessage({ open, onClose, to, defaultChannel, defaultBody, purpose = 'manual', onSent }: {
  open: boolean; onClose: () => void; to: Recipient | null; defaultChannel?: 'sms' | 'whatsapp' | 'email'; defaultBody?: string; purpose?: string; onSent?: () => void;
}) {
  const [channel, setChannel] = useState<'sms' | 'whatsapp' | 'email'>(defaultChannel || 'sms');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [cfg, setCfg] = useState({ sms: false, whatsapp: false, email: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    getMessagingConfig().then(setCfg);
    setChannel(defaultChannel || (to?.phone ? 'sms' : 'email'));
    setBody(defaultBody || `Hi ${to?.name?.split(' ')[0] || ''}, `);
    setSubject('A message from CarePlus Hospital');
    setMsg(null);
  }, [open, to, defaultChannel, defaultBody]);

  const address = channel === 'email' ? to?.email : to?.phone;

  const send = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, to: address, subject, body, patient_id: to?.patient_id, lead_id: to?.lead_id, purpose }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg({ tone: 'red', text: d.error || 'Could not send' });
    setMsg({ tone: 'green', text: 'Message sent.' });
    onSent?.();
    setTimeout(onClose, 900);
  };

  const options = [
    { id: 'sms', label: 'SMS', icon: MessageSquare },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { id: 'email', label: 'Email', icon: Mail },
  ] as const;

  return (
    <Modal open={open} onClose={onClose} title={`Message ${to?.name || ''}`}>
      <div className="space-y-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="grid grid-cols-3 gap-2">
          {options.map((o) => (
            <button key={o.id} type="button" onClick={() => setChannel(o.id)}
              className={cn('flex flex-col items-center gap-1 rounded-xl py-2.5 text-xs font-semibold ring-1', channel === o.id ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-200')}>
              <o.icon size={16} /> {o.label}
            </button>
          ))}
        </div>
        {!cfg[channel] && <Alert tone="amber">{channel === 'email' ? 'Email (Resend)' : 'Twilio'} is not set up yet, so the Send button will not deliver.{channel === 'whatsapp' ? ' You can still tap "Open in WhatsApp" to send it from your own WhatsApp.' : ' Add the keys in your environment settings (see README).'}</Alert>}
        <p className="text-sm text-ink-soft">To: <b className="text-ink">{address || `No ${channel === 'email' ? 'email address' : 'phone number'} on file`}</b></p>
        {channel === 'email' && <label className="block"><span className="label">Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>}
        <label className="block"><span className="label">Message</span><textarea className="input min-h-[120px]" value={body} onChange={(e) => setBody(e.target.value)} /></label>
        {channel !== 'email' && <p className="text-xs text-ink-muted">{body.length} characters{body.length > 160 ? ` · ${Math.ceil(body.length / 153)} SMS segments` : ''}</p>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button>
          {channel === 'whatsapp' && <a href={whatsappLink(to?.phone, body)} target="_blank" rel="noreferrer" className={cn('btn-secondary', !body.trim() && 'pointer-events-none opacity-50')}>Open in WhatsApp</a>}
          <button className="btn-primary" disabled={busy || !address || !body.trim()} onClick={send}>{busy && <Spinner />} Send</button></div>
      </div>
    </Modal>
  );
}
