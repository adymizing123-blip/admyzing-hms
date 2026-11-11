import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildClaim, claimProblems } from '@/lib/claims';
import { DEFAULT_HOSPITAL } from '@/lib/settings';

/**
 * Sends a claim to your clearinghouse or billing service.
 * Set CLAIMS_WEBHOOK_URL (and optionally CLAIMS_WEBHOOK_TOKEN). The claim JSON is POSTed there.
 * Works with a Zapier/Make webhook, your billing company's intake endpoint, or a small adapter
 * in front of a clearinghouse API (Availity, Stedi, Office Ally, Change Healthcare).
 */
export async function POST(req: Request) {
  const me = await requireRole(['accountant', 'receptionist']);
  if (!me) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const url = process.env.CLAIMS_WEBHOOK_URL;
  if (!url) return NextResponse.json({ error: 'Electronic submission is not set up. Add CLAIMS_WEBHOOK_URL (see README), or print the claim form.' }, { status: 400 });

  const { claim_id } = await req.json();
  const db = createAdminClient();
  const { data: claim } = await db.from('insurance_claims').select('*, invoices(*, patients(*), invoice_items(*))').eq('id', claim_id).single();
  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  const { data: s } = await db.from('settings').select('value').eq('key', 'hospital').maybeSingle();
  const payload = buildClaim(claim, { ...DEFAULT_HOSPITAL, ...(s?.value || {}) });
  const problems = claimProblems(payload);
  if (problems.length) return NextResponse.json({ error: `Fix before sending: ${problems.join(' ')}` }, { status: 400 });

  let status = 'sent', response = '';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.CLAIMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.CLAIMS_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify(payload),
    });
    response = (await r.text()).slice(0, 2000);
    if (!r.ok) status = 'failed';
  } catch (e: any) {
    status = 'failed';
    response = e.message;
  }
  await db.from('insurance_claims').update({ submission_status: status, submission_response: response, submitted_at: new Date().toISOString() }).eq('id', claim_id);
  if (status !== 'sent') return NextResponse.json({ error: `Clearinghouse rejected the request: ${response}` }, { status: 400 });
  return NextResponse.json({ ok: true, response });
}
