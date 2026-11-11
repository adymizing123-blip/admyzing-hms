import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { fill, sendMessage } from '@/lib/messaging';
import { DEFAULT_HOSPITAL } from '@/lib/settings';

export const maxDuration = 300;

/** Sends a campaign to its audience. Patients who opted out of marketing are skipped. */
export async function POST(req: Request) {
  const me = await requireRole(['receptionist']);
  if (!me) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const { campaign_id } = await req.json();
  const db = createAdminClient();

  const { data: c } = await db.from('campaigns').select('*').eq('id', campaign_id).single();
  if (!c) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (c.status === 'sent') return NextResponse.json({ error: 'This campaign was already sent' }, { status: 400 });
  if (!c.message?.trim()) return NextResponse.json({ error: 'Add a message first' }, { status: 400 });

  const { data: s } = await db.from('settings').select('value').eq('key', 'hospital').maybeSingle();
  const hospital = { ...DEFAULT_HOSPITAL, ...(s?.value || {}) };

  type R = { first_name: string; phone: string | null; email: string | null; patient_id?: string; lead_id?: string };
  let recipients: R[] = [];
  const audience = c.audience || 'all_patients';
  if (audience === 'all_leads' || audience === 'new_leads') {
    let q = db.from('leads').select('id, name, phone, email').neq('status', 'converted');
    if (audience === 'new_leads') q = q.eq('status', 'new');
    const { data } = await q;
    recipients = (data || []).map((l) => ({ first_name: l.name.split(' ')[0], phone: l.phone, email: l.email, lead_id: l.id }));
  } else {
    let q = db.from('patients').select('id, first_name, phone, email').eq('marketing_opt_out', false);
    if (audience === 'recent_patients') {
      const since = new Date(Date.now() - 90 * 864e5).toISOString();
      const { data: v } = await db.from('visits').select('patient_id').gte('created_at', since);
      const ids = Array.from(new Set((v || []).map((x) => x.patient_id)));
      if (!ids.length) recipients = [];
      else q = q.in('id', ids);
      if (!ids.length) {
        await db.from('campaigns').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', c.id);
        return NextResponse.json({ sent: 0, failed: 0, skipped: 0 });
      }
    }
    const { data } = await q;
    recipients = (data || []).map((p) => ({ first_name: p.first_name, phone: p.phone, email: p.email, patient_id: p.id }));
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const r of recipients) {
    const body = fill(c.message, { first_name: r.first_name, hospital: hospital.name, phone: hospital.phone })
      + (c.channel === 'email' ? '' : `\nReply STOP to opt out.`);
    const res = await sendMessage({
      channel: c.channel, to: c.channel === 'email' ? r.email : r.phone, subject: c.subject || c.name, body,
      purpose: 'campaign', campaign_id: c.id, patient_id: r.patient_id, lead_id: r.lead_id, sent_by: me.id,
    });
    if (res.status === 'sent') sent++; else if (res.status === 'failed') failed++; else skipped++;
  }

  await db.from('campaigns').update({ status: 'sent', sent_at: new Date().toISOString(), sent_count: sent, failed_count: failed + skipped }).eq('id', c.id);
  return NextResponse.json({ sent, failed, skipped });
}
