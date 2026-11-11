import { createAdminClient } from '@/lib/supabase/admin';
import { hl7Ack, parseHL7 } from '@/lib/hl7';
import { applyLabResults } from '@/lib/lab-import';

/**
 * Lab analyzer / LIS interface. POST an HL7 v2 ORU^R01 message as the request body.
 * Header: Authorization: Bearer <LAB_INTERFACE_TOKEN>
 * Most analyzers talk to a middleware (e.g. an interface engine like Mirth Connect) that can forward ORU messages over HTTPS to this URL.
 * Replies with an HL7 ACK (AA = accepted, AE = error).
 */
export async function POST(req: Request) {
  const token = process.env.LAB_INTERFACE_TOKEN;
  if (!token || req.headers.get('authorization') !== `Bearer ${token}`) return new Response('Unauthorized', { status: 401 });
  const raw = await req.text();
  try {
    const msg = parseHL7(raw);
    const report = await applyLabResults(createAdminClient(), msg, raw, 'hl7-interface');
    const ok = report.some((r) => r.matched > 0);
    const text = report.map((r) => `${r.orderNo}: ${r.error || `${r.matched} applied`}`).join('; ');
    return new Response(hl7Ack(msg.controlId, ok, text), { status: ok ? 200 : 422, headers: { 'Content-Type': 'application/hl7-v2' } });
  } catch (e: any) {
    await createAdminClient().from('lab_interface_log').insert({ source: 'hl7-interface', message: raw.slice(0, 20000), status: 'rejected', details: e.message });
    return new Response(hl7Ack('', false, e.message), { status: 400, headers: { 'Content-Type': 'application/hl7-v2' } });
  }
}
