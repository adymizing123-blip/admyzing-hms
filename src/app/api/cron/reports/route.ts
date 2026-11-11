import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendMessage } from '@/lib/messaging';
import { reportSummary, summaryText } from '@/lib/report-summary';
import { DEFAULT_HOSPITAL } from '@/lib/settings';

export const maxDuration = 300;

/** Daily job: emails each due report schedule (daily = every day, weekly = Mondays, monthly = 1st). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = createAdminClient();
  const { data: s } = await db.from('settings').select('value').eq('key', 'hospital').maybeSingle();
  const h = { ...DEFAULT_HOSPITAL, timezone: 'America/Chicago', ...(s?.value || {}) };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: h.timezone });
  const d = new Date(`${today}T12:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const minus = (n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - n); return iso(x); };

  const { data: schedules } = await db.from('report_schedules').select('*, branches(name)').eq('active', true);
  let sent = 0;
  for (const r of schedules || []) {
    if (r.last_sent_at && new Date(r.last_sent_at).toLocaleDateString('en-CA', { timeZone: h.timezone }) === today) continue;
    let from = '', to = minus(1), title = '';
    if (r.frequency === 'daily') { from = to; title = 'Daily report'; }
    else if (r.frequency === 'weekly') { if (d.getUTCDay() !== 1) continue; from = minus(7); title = 'Weekly report'; }
    else { if (d.getUTCDate() !== 1) continue; const first = new Date(d); first.setUTCMonth(first.getUTCMonth() - 1); first.setUTCDate(1); from = iso(first); title = 'Monthly report'; }
    const summary = await reportSummary(db, from, to, r.branch_id);
    const body = summaryText(`${title}${r.branches ? ` · ${r.branches.name}` : ''}: ${r.name}`, from, to, summary, h.name);
    for (const email of String(r.recipients).split(/[,;\s]+/).filter(Boolean)) {
      const res = await sendMessage({ channel: 'email', to: email, subject: `${h.name} ${title.toLowerCase()} (${from === to ? from : `${from} to ${to}`})`, body, purpose: 'report' });
      if (res.status === 'sent') sent++;
    }
    await db.from('report_schedules').update({ last_sent_at: new Date().toISOString() }).eq('id', r.id);
  }
  return NextResponse.json({ sent });
}
