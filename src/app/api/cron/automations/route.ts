import { NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Sends every automation that is due (reminders, confirmations, follow-ups, birthdays ...).
 * Call it every 5-10 minutes: Supabase pg_cron (supabase/09_automation_scheduler.sql), Vercel Cron (Pro) or any uptime pinger.
 * Protected by CRON_SECRET, sent as "Authorization: Bearer <secret>" (Vercel does this automatically) or ?secret=<secret>.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer /, '') || new URL(req.url).searchParams.get('secret');
  if (!secret || given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runAutomations({ scan: true, limit: 300 }));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
