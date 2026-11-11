import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Parses webhooks from Meta (WhatsApp Cloud API, Facebook Messenger, Instagram DMs) and Twilio (WhatsApp / SMS)
 * into one shape. Pure functions so they can be unit tested.
 */
export type ChatChannel = 'whatsapp' | 'facebook' | 'instagram' | 'sms';

export type Inbound = {
  channel: ChatChannel;
  accountId: string;          // WhatsApp phone number ID / Page ID / Instagram account ID / Twilio number
  externalId: string;         // the person: +923001234567 or their Facebook / Instagram ID
  name?: string | null;
  body?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
  providerId?: string | null;
  referral?: Record<string, any> | null;
  direction: 'in' | 'out';    // "out" = a reply sent from the phone app / Meta inbox (echo)
  at?: string | null;
};

export type StatusUpdate = { providerId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; error?: string | null };

const plus = (n?: string | null) => (n ? (n.startsWith('+') ? n : `+${n}`) : '');
const iso = (unixSec?: string | number | null) => (unixSec ? new Date(Number(unixSec) * (String(unixSec).length > 11 ? 1 : 1000)).toISOString() : null);

function waContent(m: any): Pick<Inbound, 'body' | 'mediaType' | 'mediaUrl'> {
  switch (m.type) {
    case 'text': return { body: m.text?.body ?? '' };
    case 'image': case 'video': case 'audio': case 'document': case 'sticker': {
      const x = m[m.type] || {};
      return { body: x.caption || x.filename || null, mediaType: m.type, mediaUrl: x.id ? `wa:${x.id}` : null };
    }
    case 'location': {
      const l = m.location || {};
      return { body: [l.name, l.address].filter(Boolean).join(', ') || null, mediaType: 'location', mediaUrl: `https://maps.google.com/?q=${l.latitude},${l.longitude}` };
    }
    case 'button': return { body: m.button?.text ?? '' };
    case 'interactive': return { body: m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '' };
    case 'reaction': return { body: m.reaction?.emoji ? `Reacted ${m.reaction.emoji}` : null };
    case 'contacts': return { body: (m.contacts || []).map((c: any) => `${c.name?.formatted_name || ''} ${c.phones?.[0]?.phone || ''}`.trim()).join(', ') };
    default: return { body: `[${m.type || 'message'}]` };
  }
}

export function parseMeta(payload: any): { messages: Inbound[]; statuses: StatusUpdate[] } {
  const messages: Inbound[] = [];
  const statuses: StatusUpdate[] = [];
  if (!payload || !Array.isArray(payload.entry)) return { messages, statuses };

  if (payload.object === 'whatsapp_business_account') {
    for (const e of payload.entry) for (const ch of e.changes || []) {
      const v = ch.value || {};
      const acc = v.metadata?.phone_number_id;
      if (!acc) continue;
      if (ch.field === 'messages') {
        const names: Record<string, string> = {};
        (v.contacts || []).forEach((c: any) => { if (c.wa_id) names[c.wa_id] = c.profile?.name; });
        for (const m of v.messages || []) {
          if (m.type === 'unsupported' || m.type === 'system') continue;
          messages.push({
            channel: 'whatsapp', accountId: acc, externalId: plus(m.from), name: names[m.from] || null, providerId: m.id,
            referral: m.referral ? { source_type: m.referral.source_type, source_url: m.referral.source_url, headline: m.referral.headline, body: m.referral.body, ctwa_clid: m.referral.ctwa_clid } : null,
            direction: 'in', at: iso(m.timestamp), ...waContent(m),
          });
        }
        for (const s of v.statuses || []) {
          if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
          const err = s.errors?.[0];
          statuses.push({ providerId: s.id, status: s.status, error: err ? [err.title, err.error_data?.details].filter(Boolean).join(': ') : null });
        }
      } else if (ch.field === 'smb_message_echoes') {
        // replies typed in the WhatsApp Business app on the phone (coexistence)
        for (const m of v.message_echoes || []) {
          messages.push({ channel: 'whatsapp', accountId: acc, externalId: plus(m.to), providerId: m.id, direction: 'out', at: iso(m.timestamp), ...waContent(m) });
        }
      }
    }
    return { messages, statuses };
  }

  if (payload.object === 'page' || payload.object === 'instagram') {
    const channel: ChatChannel = payload.object === 'page' ? 'facebook' : 'instagram';
    for (const e of payload.entry) for (const ev of e.messaging || []) {
      const acc = String(e.id);
      const msg = ev.message;
      if (msg) {
        if (msg.is_deleted || msg.is_unsupported) continue;
        const echo = !!msg.is_echo;
        const att = (msg.attachments || [])[0];
        const ref = msg.referral || ev.referral || null;
        messages.push({
          channel, accountId: acc, externalId: String(echo ? ev.recipient?.id : ev.sender?.id), providerId: msg.mid,
          body: msg.text ?? (att ? null : ''), mediaType: att?.type || null, mediaUrl: att?.payload?.url || null,
          referral: ref ? { source: ref.source, type: ref.type, ref: ref.ref, ad_id: ref.ad_id, ad_title: ref.ads_context_data?.ad_title, source_url: ref.ads_context_data?.photo_url } : null,
          direction: echo ? 'out' : 'in', at: iso(ev.timestamp),
        });
      } else if (ev.postback) {
        messages.push({
          channel, accountId: acc, externalId: String(ev.sender?.id), providerId: ev.postback.mid || null, body: ev.postback.title || ev.postback.payload,
          referral: ev.postback.referral ? { ref: ev.postback.referral.ref, source: ev.postback.referral.source, ad_id: ev.postback.referral.ad_id } : null,
          direction: 'in', at: iso(ev.timestamp),
        });
      }
    }
  }
  return { messages, statuses };
}

/** Twilio posts form fields: From "whatsapp:+92300..." or "+1512...", To, Body, ProfileName, MessageSid, MediaUrl0 ... */
export function parseTwilio(p: Record<string, string>): Inbound | null {
  if (!p.From || !p.To) return null;
  const wa = p.From.startsWith('whatsapp:');
  const strip = (s: string) => s.replace(/^whatsapp:/, '');
  const n = Number(p.NumMedia || 0);
  const headline = p.ReferralHeadline || p.ReferralBody;
  return {
    channel: wa ? 'whatsapp' : 'sms', accountId: strip(p.To), externalId: strip(p.From), name: p.ProfileName || null,
    body: p.Body ?? '', mediaType: n > 0 ? (p.MediaContentType0 || 'file').split('/')[0] : null, mediaUrl: n > 0 ? p.MediaUrl0 : null,
    providerId: p.MessageSid || p.SmsMessageSid || null,
    referral: headline || p.ReferralSourceUrl ? { headline, source_url: p.ReferralSourceUrl, source_type: p.ReferralSourceType, ctwa_clid: p.ReferralCtwaClid } : null,
    direction: 'in',
  };
}

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex> */
export function verifyMetaSignature(raw: string, header: string | null, appSecret: string) {
  if (!header || !appSecret) return false;
  return safeEq(header, 'sha256=' + createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex'));
}

/** Twilio: base64(HMAC-SHA1(auth token, full URL + each POST field name and value, sorted by name)) */
export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | null, authToken: string) {
  if (!header || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return safeEq(header, createHmac('sha1', authToken).update(data, 'utf8').digest('base64'));
}
