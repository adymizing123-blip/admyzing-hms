import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { channelStatus } from '@/lib/channels';

export const dynamic = 'force-dynamic';

/** Which services are connected (no secrets are returned). */
export async function GET(req: Request) {
  if (!(await requireRole(['receptionist', 'doctor', 'nurse']))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const site = (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, '');
  return NextResponse.json({
    ...channelStatus(),
    metaWebhookUrl: `${site}/api/webhooks/meta`,
    twilioWebhookUrl: `${site}/api/webhooks/twilio`,
    cronUrl: `${site}/api/cron/automations`,
  });
}
