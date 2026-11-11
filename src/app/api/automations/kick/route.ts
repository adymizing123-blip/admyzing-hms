import { NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations';

export const dynamic = 'force-dynamic';

let last = 0;

/**
 * Public nudge after a website booking or contact form, so the confirmation goes out right away
 * instead of on the next cron run. It only sends jobs that are already due; it takes no input.
 */
export async function POST() {
  if (Date.now() - last < 15000) return NextResponse.json({ ok: true, throttled: true });
  last = Date.now();
  try {
    const r = await runAutomations({ scan: false, limit: 20 });
    return NextResponse.json({ ok: true, sent: r.sent });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
