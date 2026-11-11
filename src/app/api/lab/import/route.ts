import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseHL7, parseResultsCSV } from '@/lib/hl7';
import { applyLabResults } from '@/lib/lab-import';

/** Staff paste or upload an HL7 file / CSV exported from an analyzer. */
export async function POST(req: Request) {
  if (!(await requireRole(['lab_tech']))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const { text } = await req.json();
  try {
    const msg = text.trim().startsWith('MSH') ? parseHL7(text) : parseResultsCSV(text);
    const report = await applyLabResults(createAdminClient(), msg, text, 'manual-import');
    return NextResponse.json({ report });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
