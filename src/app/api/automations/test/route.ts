import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { testAutomation } from '@/lib/automations';

/** Send one rule's message with sample values to a phone or email: { rule, to } */
export async function POST(req: Request) {
  const me = await requireRole([]);
  if (!me) return NextResponse.json({ error: 'Only admins can send tests' }, { status: 403 });
  const { rule, to } = await req.json();
  if (!rule?.template?.trim() || !to?.trim()) return NextResponse.json({ error: 'Add a message and a phone or email' }, { status: 400 });
  const r = await testAutomation(rule, to.trim(), me.id);
  if (r.status !== 'sent') return NextResponse.json({ error: r.error || 'Not sent' }, { status: 400 });
  return NextResponse.json(r);
}
