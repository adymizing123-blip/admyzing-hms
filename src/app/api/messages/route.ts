import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { messagingConfig, sendMessage, type Channel } from '@/lib/messaging';

const ROLES = ['receptionist', 'doctor', 'nurse', 'pharmacist', 'lab_tech', 'accountant'] as any;

export async function GET() {
  if (!(await requireRole(ROLES))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  return NextResponse.json(messagingConfig());
}

/** Send one message: { channel, to, body, subject?, patient_id?, lead_id?, purpose? } */
export async function POST(req: Request) {
  const me = await requireRole(ROLES);
  if (!me) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const b = await req.json();
  if (!['sms', 'whatsapp', 'email'].includes(b.channel)) return NextResponse.json({ error: 'Choose SMS, WhatsApp or email' }, { status: 400 });
  if (!b.body?.trim()) return NextResponse.json({ error: 'Message is empty' }, { status: 400 });
  const r = await sendMessage({ ...b, channel: b.channel as Channel, sent_by: me.id });
  if (r.status !== 'sent') return NextResponse.json({ error: r.error, status: r.status }, { status: 400 });
  return NextResponse.json(r);
}
