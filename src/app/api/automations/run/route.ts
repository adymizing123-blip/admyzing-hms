import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { runAutomations } from '@/lib/automations';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** "Run now" on the Automations screen, and called after staff book an appointment so the confirmation goes out at once. */
export async function POST() {
  if (!(await requireRole(['receptionist', 'doctor', 'nurse']))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  try {
    return NextResponse.json(await runAutomations({ scan: true, limit: 100 }));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
