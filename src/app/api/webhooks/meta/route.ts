import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseMeta, verifyMetaSignature } from '@/lib/meta-webhook';
import { lookupProfile } from '@/lib/channels';
import { runAutomations } from '@/lib/automations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const RANK: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };

/** Meta checks the webhook once when you save it in the app dashboard. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && process.env.META_VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN) {
    return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

/** WhatsApp Cloud API, Facebook Messenger and Instagram messages all arrive here. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!process.env.META_APP_SECRET) return NextResponse.json({ error: 'META_APP_SECRET is not set' }, { status: 500 });
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.META_APP_SECRET)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  const db = createAdminClient();
  const { messages, statuses } = parseMeta(payload);
  const toProcess = new Set<string>();

  for (const m of messages) {
    const { data, error } = await db.rpc('inbox_receive', {
      p_channel: m.channel, p_account_id: m.accountId, p_external: m.externalId, p_name: m.name || null, p_body: m.body ?? null,
      p_media_type: m.mediaType || null, p_media_url: m.mediaUrl || null, p_provider_id: m.providerId || null,
      p_referral: m.referral || null, p_direction: m.direction, p_at: m.at || null,
    });
    if (error || !data || data.duplicate) continue;
    // Facebook / Instagram only send an ID: look up the name once
    if (data.new_conversation && !m.name && (m.channel === 'facebook' || m.channel === 'instagram')) {
      const { data: acc } = await db.from('channel_accounts').select('channel, account_id, page_id').eq('channel', m.channel).eq('account_id', m.accountId).maybeSingle();
      const name = await lookupProfile(acc || { channel: m.channel, account_id: m.accountId }, m.externalId);
      if (name) {
        await db.from('conversations').update({ contact_name: name }).eq('id', data.conversation_id);
        if (data.lead_id) await db.from('leads').update({ name }).eq('id', data.lead_id).eq('name', m.externalId);
      }
    }
    if (m.direction === 'in') toProcess.add(data.conversation_id);
  }

  for (const s of statuses) {
    const { data: cur } = await db.from('conversation_messages').select('id, status').eq('provider_message_id', s.providerId).maybeSingle();
    if (cur && (s.status === 'failed' || RANK[s.status] > (RANK[cur.status] ?? 0))) {
      await db.from('conversation_messages').update({ status: s.status, error: s.error || null }).eq('id', cur.id);
    }
  }

  // instant auto-replies for these chats
  for (const id of Array.from(toProcess)) {
    try { await runAutomations({ scan: false, conversationId: id, limit: 10 }); } catch { /* the cron retries */ }
  }
  return NextResponse.json({ ok: true });
}
