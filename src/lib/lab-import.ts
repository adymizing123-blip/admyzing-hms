import type { SupabaseClient } from '@supabase/supabase-js';
import type { HL7Message } from './hl7';

/** Applies parsed results to matching lab orders. Matching: order number, then test code (our code or CPT). */
export async function applyLabResults(db: SupabaseClient, msg: HL7Message, raw: string, source: string) {
  const report: { orderNo: string; matched: number; unmatched: string[]; completed: boolean; error?: string }[] = [];
  for (const o of msg.orders) {
    const no = (o.orderNo || o.fillerNo).toUpperCase();
    const { data: order } = await db.from('lab_orders')
      .select('id, status, patients(mrn), lab_order_items(id, result, lab_tests(code, cpt_code, name))')
      .eq('order_no', no).maybeSingle();
    if (!order) { report.push({ orderNo: no, matched: 0, unmatched: o.results.map((r) => r.code), completed: false, error: 'Order not found' }); continue; }
    if (msg.mrn && (order as any).patients?.mrn && (order as any).patients.mrn !== msg.mrn) {
      report.push({ orderNo: no, matched: 0, unmatched: [], completed: false, error: `Patient mismatch (message MRN ${msg.mrn})` }); continue;
    }
    if (order.status === 'completed') { report.push({ orderNo: no, matched: 0, unmatched: [], completed: true, error: 'Already completed' }); continue; }
    let matched = 0; const unmatched: string[] = [];
    const items = (order as any).lab_order_items as any[];
    for (const r of o.results) {
      const code = r.code.toUpperCase();
      const item = items.find((i) => [i.lab_tests?.code, i.lab_tests?.cpt_code].filter(Boolean).map((x: string) => x.toUpperCase()).includes(code))
        || items.find((i) => i.lab_tests?.name?.toLowerCase() === r.name.toLowerCase());
      if (!item) { unmatched.push(r.code); continue; }
      const value = [r.value, r.units && !r.value.includes(r.units) ? r.units : ''].filter(Boolean).join(' ');
      await db.from('lab_order_items').update({ result: value, flag: r.flag }).eq('id', item.id);
      item.result = value; matched++;
    }
    const complete = items.every((i) => i.result);
    if (matched) await db.from('lab_orders').update(complete ? { status: 'completed', completed_at: new Date().toISOString() } : { status: 'processing' }).eq('id', order.id);
    report.push({ orderNo: no, matched, unmatched, completed: complete });
    await db.from('lab_interface_log').insert({
      source, message: raw.slice(0, 20000), lab_order_id: order.id,
      status: matched === 0 ? 'rejected' : unmatched.length ? 'partial' : 'applied',
      details: `${matched} result(s) applied${unmatched.length ? `, unmatched: ${unmatched.join(', ')}` : ''}${complete ? ', order completed' : ''}`,
    });
  }
  return report;
}
