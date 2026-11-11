import { createAdminClient } from '@/lib/supabase/admin';
import { toE164 } from './phone';

/**
 * Server-only. Sends chat messages through Meta (WhatsApp Cloud API, Messenger, Instagram) or Twilio,
 * and records every message in the Chats inbox.
 *
 * Env:
 *   META_ACCESS_TOKEN        System user token with whatsapp_business_messaging, pages_messaging, instagram_manage_messages
 *   META_PAGE_TOKENS         Optional JSON {"<page id>":"<page token>"} if pages need their own tokens
 *   META_WA_PHONE_NUMBER_ID  Default WhatsApp sender when no clinic number is added under Chats > Channels
 *   META_APP_SECRET, META_VERIFY_TOKEN   for the webhook
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_WHATSAPP_FROM
 */
const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;
const DAY = 24 * 3600e3;

export type WaTemplate = { name: string; language?: string | null; params?: string[] };

export function channelStatus() {
  const twilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  return {
    meta: !!process.env.META_ACCESS_TOKEN,
    metaWebhook: !!(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN),
    metaDefaultWhatsapp: !!process.env.META_WA_PHONE_NUMBER_ID,
    twilioSms: twilio && !!process.env.TWILIO_FROM_NUMBER,
    twilioWhatsapp: twilio && !!process.env.TWILIO_WHATSAPP_FROM,
    email: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    cron: !!process.env.CRON_SECRET,
  };
}

function tokenFor(id?: string | null) {
  try {
    const map = JSON.parse(process.env.META_PAGE_TOKENS || '{}');
    if (id && map[id]) return map[id] as string;
  } catch { /* ignore bad JSON */ }
  return process.env.META_ACCESS_TOKEN || '';
}

async function graphPost(path: string, body: any, token: string) {
  if (!token) throw new Error('Meta is not connected (META_ACCESS_TOKEN missing)');
  const res = await fetch(`${GRAPH()}/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.error_user_msg || data.error?.message || `Meta error ${res.status}`);
  return data;
}

export async function twilioSend(to: string, from: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (!sid || !process.env.TWILIO_AUTH_TOKEN) throw new Error('Twilio is not set up');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`);
  return data.sid as string;
}

export async function waCloudSend(phoneNumberId: string, to: string, msg: { text: string } | { template: WaTemplate }) {
  const body: any = { messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/\D/g, '') };
  if ('text' in msg) Object.assign(body, { type: 'text', text: { body: msg.text, preview_url: true } });
  else {
    const t = msg.template;
    body.type = 'template';
    body.template = { name: t.name, language: { code: t.language || 'en' } };
    if (t.params?.length) body.template.components = [{ type: 'body', parameters: t.params.map((p) => ({ type: 'text', text: p || '-' })) }];
  }
  const d = await graphPost(`${phoneNumberId}/messages`, body, tokenFor(phoneNumberId));
  return d.messages?.[0]?.id as string;
}

/** Messenger and Instagram replies. More than 24h after their last message needs the Human Agent tag (up to 7 days). */
export async function metaDmSend(acc: { channel: string; account_id: string; page_id?: string | null }, recipientId: string, text: string, humanAgent = false) {
  const from = acc.channel === 'instagram' ? acc.page_id || 'me' : acc.account_id;
  const body: any = { recipient: { id: recipientId }, message: { text }, messaging_type: humanAgent ? 'MESSAGE_TAG' : 'RESPONSE' };
  if (humanAgent) body.tag = 'HUMAN_AGENT';
  const d = await graphPost(`${from}/messages`, body, tokenFor(acc.channel === 'instagram' ? acc.page_id : acc.account_id));
  return d.message_id as string;
}

/** Best effort: the person's name on Facebook / Instagram (the webhook only gives an ID). */
export async function lookupProfile(acc: { channel: string; account_id: string; page_id?: string | null }, id: string) {
  try {
    const fields = acc.channel === 'instagram' ? 'name,username' : 'first_name,last_name';
    const res = await fetch(`${GRAPH()}/${id}?fields=${fields}`, { headers: { Authorization: `Bearer ${tokenFor(acc.channel === 'instagram' ? acc.page_id : acc.account_id)}` } });
    if (!res.ok) return null;
    const d = await res.json();
    return d.name || d.username || [d.first_name, d.last_name].filter(Boolean).join(' ') || null;
  } catch { return null; }
}

/** Temporary download link for WhatsApp media (images, voice notes, documents). */
export async function waMediaUrl(mediaId: string) {
  const res = await fetch(`${GRAPH()}/${mediaId}`, { headers: { Authorization: `Bearer ${tokenFor(null)}` } });
  if (!res.ok) throw new Error('Media not found');
  const d = await res.json();
  return { url: d.url as string, mime: d.mime_type as string, token: tokenFor(null) };
}

type SendOpts = { sent_by?: string | null; automated?: boolean; template?: WaTemplate | null; displayText?: string };

/** Send in an existing chat, from the right clinic number / page, and save it in the thread. */
export async function sendInConversation(conversationId: string, text: string, opts: SendOpts = {}) {
  const db = createAdminClient();
  const { data: c, error } = await db.from('conversations').select('*, channel_accounts(*)').eq('id', conversationId).single();
  if (error || !c) return { status: 'failed' as const, error: 'Chat not found' };
  const acc = c.channel_accounts as any;
  const age = c.last_inbound_at ? Date.now() - new Date(c.last_inbound_at).getTime() : Infinity;
  let providerId: string | null = null;
  let err: string | null = null;

  try {
    if (!text.trim() && !opts.template) throw new Error('Message is empty');
    if (c.channel === 'whatsapp') {
      const useTwilio = acc ? acc.provider === 'twilio' : !(process.env.META_ACCESS_TOKEN && process.env.META_WA_PHONE_NUMBER_ID) && !!process.env.TWILIO_WHATSAPP_FROM;
      if (useTwilio) {
        providerId = await twilioSend(`whatsapp:${c.external_id}`, `whatsapp:${acc?.account_id || process.env.TWILIO_WHATSAPP_FROM}`, text);
      } else {
        const pid = acc?.account_id || process.env.META_WA_PHONE_NUMBER_ID;
        if (!pid) throw new Error('No WhatsApp number connected. Add one under Chats > Channels.');
        if (opts.template) providerId = await waCloudSend(pid, c.external_id, { template: opts.template });
        else if (age > DAY) throw new Error('More than 24 hours since this person last wrote. WhatsApp only allows an approved template message now.');
        else providerId = await waCloudSend(pid, c.external_id, { text });
      }
    } else if (c.channel === 'sms') {
      providerId = await twilioSend(c.external_id, acc?.account_id || process.env.TWILIO_FROM_NUMBER!, text);
    } else {
      if (!acc) throw new Error('This page or account is not connected. Add it under Chats > Channels.');
      if (age > 7 * DAY) throw new Error('More than 7 days since this person last wrote. Facebook and Instagram do not allow a reply now.');
      providerId = await metaDmSend(acc, c.external_id, text, age > DAY);
    }
  } catch (e: any) {
    err = e.message;
  }

  const { data: msg } = await db.from('conversation_messages').insert({
    conversation_id: c.id, direction: 'out', body: opts.displayText || text || (opts.template ? `[Template: ${opts.template.name}]` : ''),
    provider_message_id: providerId, status: err ? 'failed' : 'sent', error: err, sent_by: opts.sent_by || null, automated: !!opts.automated,
  }).select('*').single();

  return err ? { status: 'failed' as const, error: err, message: msg } : { status: 'sent' as const, provider_id: providerId, message: msg };
}

/**
 * WhatsApp to a phone number (reminders, prescriptions, campaigns, automations).
 * Uses the clinic's own WhatsApp number when one is connected, and saves the message in Chats.
 */
export async function sendWhatsApp(m: { to: string; body: string; patient_id?: string | null; lead_id?: string | null; branch_id?: string | null;
  name?: string | null; sent_by?: string | null; automated?: boolean; template?: WaTemplate | null }) {
  const e164 = toE164(m.to);
  if (!e164) return { status: 'skipped' as const, error: 'No valid phone number', to: m.to };
  const db = createAdminClient();
  const { data: accounts } = await db.from('channel_accounts').select('id, branch_id, provider').eq('channel', 'whatsapp').eq('active', true).order('created_at');
  const acc = (accounts || []).find((a: any) => m.branch_id && a.branch_id === m.branch_id) || (accounts || [])[0] || null;
  const metaDefault = !!(process.env.META_ACCESS_TOKEN && process.env.META_WA_PHONE_NUMBER_ID);
  if (!acc && !metaDefault && !process.env.TWILIO_WHATSAPP_FROM) return { status: 'skipped' as const, error: 'WHATSAPP is not configured', to: e164 };

  const { data: convId, error } = await db.rpc('inbox_conversation', {
    p_channel: 'whatsapp', p_account: acc?.id || null, p_external: e164, p_name: m.name || null,
    p_patient: m.patient_id || null, p_lead: m.lead_id || null, p_branch: m.branch_id || null,
  });
  if (error) return { status: 'failed' as const, error: error.message, to: e164 };
  const r = await sendInConversation(convId as string, m.body, { sent_by: m.sent_by, automated: m.automated, template: m.template, displayText: m.body });
  return { ...r, to: e164, conversation_id: convId as string };
}
