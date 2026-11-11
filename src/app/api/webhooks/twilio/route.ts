import { createAdminClient } from '@/lib/supabase/admin';
import { parseTwilio, verifyTwilioSignature } from '@/lib/meta-webhook';
import { runAutomations } from '@/lib/automations';

export const dynamic = 'force-dynamic';

const xml = (status = 200) => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status, headers: { 'Content-Type': 'text/xml' } });

/**
 * Incoming Twilio WhatsApp and SMS. In Twilio, set "A message comes in" for your number (or WhatsApp sender)
 * to https://YOUR-DOMAIN/api/webhooks/twilio (HTTP POST). Delivery status callbacks can use the same URL.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { params[k] = String(v); });
  const url = process.env.TWILIO_WEBHOOK_URL || `${(process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')}/api/webhooks/twilio`;
  if (!verifyTwilioSignature(url, params, req.headers.get('x-twilio-signature'), process.env.TWILIO_AUTH_TOKEN || '')) return xml(401);

  const db = createAdminClient();
  if (params.MessageStatus && params.Body === undefined) {
    const status = ({ sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', undelivered: 'failed' } as any)[params.MessageStatus];
    if (status) await db.from('conversation_messages').update({ status, error: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null }).eq('provider_message_id', params.MessageSid);
    return xml();
  }
  const m = parseTwilio(params);
  if (!m) return xml();
  const { data } = await db.rpc('inbox_receive', {
    p_channel: m.channel, p_account_id: m.accountId, p_external: m.externalId, p_name: m.name || null, p_body: m.body ?? null,
    p_media_type: m.mediaType || null, p_media_url: m.mediaUrl || null, p_provider_id: m.providerId || null, p_referral: m.referral || null,
  });
  if (data?.conversation_id && !data.duplicate) {
    try { await runAutomations({ scan: false, conversationId: data.conversation_id, limit: 10 }); } catch { /* the cron retries */ }
  }
  return xml();
}
