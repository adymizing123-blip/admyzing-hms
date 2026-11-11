import { createAdminClient } from '@/lib/supabase/admin';
import { toE164 } from './phone';
import { sendWhatsApp, twilioSend, type WaTemplate } from './channels';
import { fill } from './automation-core';

/**
 * Server-only messaging. SMS + WhatsApp through Twilio, email through Resend.
 * Every attempt is written to message_log (sent / failed / skipped).
 *
 * Env:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (+15125550100)
 *   TWILIO_WHATSAPP_FROM (+14155238886 for the Twilio sandbox, or your approved WhatsApp number)
 *   or Meta WhatsApp Cloud API: META_ACCESS_TOKEN + a WhatsApp number under Chats > Channels (or META_WA_PHONE_NUMBER_ID)
 *   WhatsApp messages are also saved in the Chats inbox.
 *   RESEND_API_KEY, EMAIL_FROM ("CarePlus Hospital <hello@yourdomain.com>")
 */
export type Channel = 'sms' | 'whatsapp' | 'email';

export function messagingConfig() {
  return {
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
    whatsapp: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) || !!process.env.META_ACCESS_TOKEN,
    email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  };
}

export { toE164 };

export { fill };

async function resend(to: string, subject: string, body: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">${body
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend error ${res.status}`);
  return data.id as string;
}

export type SendInput = {
  channel: Channel;
  to: string | null | undefined;
  body: string;
  subject?: string | null;
  purpose?: string;
  patient_id?: string | null;
  lead_id?: string | null;
  campaign_id?: string | null;
  sent_by?: string | null;
  branch_id?: string | null;
  name?: string | null;
  automated?: boolean;
  /** WhatsApp only: approved template, needed when the person has not written in the last 24 hours (Meta) */
  template?: WaTemplate | null;
};

export async function sendMessage(m: SendInput) {
  const cfg = messagingConfig();
  let status: 'sent' | 'failed' | 'skipped' = 'sent';
  let provider_id: string | null = null;
  let error: string | null = null;
  let to = m.to?.trim() || '';

  try {
    if (!cfg[m.channel]) throw Object.assign(new Error(`${m.channel.toUpperCase()} is not configured`), { skip: true });
    if (m.channel === 'email') {
      if (!/^\S+@\S+\.\S+$/.test(to)) throw Object.assign(new Error('No valid email address'), { skip: true });
      provider_id = await resend(to, m.subject || 'Message from CarePlus Hospital', m.body);
    } else {
      const e164 = toE164(to);
      if (!e164) throw Object.assign(new Error('No valid phone number'), { skip: true });
      to = e164;
      if (m.channel === 'sms') provider_id = await twilioSend(e164, process.env.TWILIO_FROM_NUMBER!, m.body);
      else {
        const r = await sendWhatsApp({ to: e164, body: m.body, patient_id: m.patient_id, lead_id: m.lead_id, branch_id: m.branch_id,
          name: m.name, sent_by: m.sent_by, automated: m.automated, template: m.template });
        if (r.status === 'skipped') throw Object.assign(new Error(r.error), { skip: true });
        if (r.status === 'failed') throw new Error(r.error);
        provider_id = (r as any).provider_id || null;
      }
    }
  } catch (e: any) {
    status = e.skip ? 'skipped' : 'failed';
    error = e.message;
  }

  await createAdminClient().from('message_log').insert({
    channel: m.channel, to_address: to || '-', subject: m.subject || null, body: m.body, status, provider_id, error,
    purpose: m.purpose || 'manual', patient_id: m.patient_id || null, lead_id: m.lead_id || null,
    campaign_id: m.campaign_id || null, sent_by: m.sent_by || null,
  });

  return { status, provider_id, error };
}

export const fmtWhen = (iso: string, tz: string) => {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }),
  };
};
