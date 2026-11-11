'use client';
import { useState } from 'react';
import { Search, Printer, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, Alert, Spinner, StatusBadge } from '@/components/ui';
import Receipt, { now } from './Receipt';
import { cn, fmtDateTime, fullName, money, titleCase } from '@/lib/utils';

/** Look up a receipt, choose items/quantities to return, refund to cash, card (reader), insurance or patient bill. */
export default function ReturnsModal({ open, onClose, onDone, terminalEnabled }: { open: boolean; onClose: () => void; onDone: () => void; terminalEnabled: boolean }) {
  const supabase = createClient();
  const [q, setQ] = useState('');
  const [sale, setSale] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<any>(null);

  const reset = () => { setSale(null); setQty({}); setRestock({}); setReason(''); setErr(''); setDone(null); setQ(''); };

  const find = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr('');
    const code = q.trim().toUpperCase();
    const { data } = await supabase.from('pharmacy_sales')
      .select('*, patients(first_name, last_name, mrn), pharmacy_sale_items(*, medicines(name, strength)), pharmacy_sale_payments(*), pharmacy_returns(*, pharmacy_return_items(*))')
      .eq('sale_no', code.startsWith('RX-') ? code : `RX-${code}`).maybeSingle();
    if (!data) return setErr('Receipt not found');
    const returned: Record<string, number> = {};
    (data.pharmacy_returns || []).forEach((r: any) => r.pharmacy_return_items.forEach((i: any) => (returned[i.sale_item_id] = (returned[i.sale_item_id] || 0) + i.quantity)));
    data.pharmacy_sale_items = data.pharmacy_sale_items.map((i: any) => ({ ...i, returnable: i.quantity - (returned[i.id] || 0) }));
    setSale(data);
    setQty({});
    setRestock(Object.fromEntries(data.pharmacy_sale_items.map((i: any) => [i.id, true])));
    const methods = data.pharmacy_sale_payments.map((p: any) => p.method);
    setMethod(methods.includes('bill') ? 'bill' : methods.includes('card') ? 'card' : methods[0] || 'cash');
  };

  const ratio = sale && Number(sale.subtotal) > 0 ? Number(sale.total) / Number(sale.subtotal) : 0;
  const lines = sale ? sale.pharmacy_sale_items.filter((i: any) => (qty[i.id] || 0) > 0) : [];
  const estimate = Math.min(lines.reduce((s: number, i: any) => s + Math.round(qty[i.id] * Number(i.unit_price) * ratio * 100) / 100, 0), sale ? Number(sale.total) - Number(sale.refunded_total) : 0);
  const cardPayment = sale?.pharmacy_sale_payments.find((p: any) => p.method === 'card' && p.reference?.startsWith('pi_'));

  const process = async () => {
    setBusy(true); setErr('');
    let reference: string | null = null;
    // refund to the original card on the reader account first, so money and records stay in sync
    if (method === 'card' && cardPayment && terminalEnabled) {
      const r = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refund', payment_intent: cardPayment.reference, amount: Math.min(estimate, Number(cardPayment.amount)) }) });
      const d = await r.json();
      if (!r.ok) { setBusy(false); return setErr(`Card refund failed: ${d.error}`); }
      reference = d.refund;
    }
    const { data, error } = await supabase.rpc('pos_refund', {
      p_sale: sale.id,
      p_items: lines.map((i: any) => ({ sale_item_id: i.id, quantity: qty[i.id], restock: restock[i.id] })),
      p_method: method, p_reason: reason || null, p_reference: reference,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone({ ...data, lines: lines.map((i: any) => ({ name: `${i.medicines?.name} ${i.medicines?.strength || ''}`.trim(), qty: qty[i.id], amount: Math.round(qty[i.id] * Number(i.unit_price) * ratio * 100) / 100 })), method });
    onDone();
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Return / refund" wide>
      {done ? (
        <div className="space-y-4">
          <p className="no-print flex items-center gap-2 font-semibold text-brand-700"><CheckCircle2 size={18} /> {done.return_no} refunded {money(done.total)} to {titleCase(done.method === 'bill' ? 'patient bill' : done.method)}</p>
          <Receipt title={`REFUND ${done.return_no}`} meta={[now(), `Original receipt ${sale.sale_no}`]} items={done.lines}
            totals={[{ label: `Refunded (${done.method === 'bill' ? 'patient bill' : done.method})`, value: money(done.total), bold: true }]} footer={reason ? `Reason: ${reason}` : undefined} />
          <div className="no-print flex justify-end gap-2"><button className="btn-secondary" onClick={reset}>New return</button><button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print</button></div>
        </div>
      ) : (
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <form onSubmit={find} className="flex gap-2">
            <div className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-ink-muted" /><input className="input pl-9" placeholder="Receipt number, e.g. RX-1001" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
            <button className="btn-primary">Find</button>
          </form>

          {sale && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                <div><p className="font-semibold">{sale.sale_no} · {money(sale.total)}</p><p className="text-xs text-ink-soft">{fmtDateTime(sale.created_at)} · {sale.patients ? `${fullName(sale.patients)} (${sale.patients.mrn})` : 'Walk-in'} · paid by {sale.pharmacy_sale_payments.map((p: any) => p.method).join(' + ')}</p></div>
                <div className="flex items-center gap-2">{Number(sale.refunded_total) > 0 && <span className="text-xs text-ink-soft">Refunded {money(sale.refunded_total)}</span>}<StatusBadge status={sale.status === 'completed' ? 'paid' : sale.status === 'refunded' ? 'void' : 'partial'} /></div>
              </div>

              <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                {sale.pharmacy_sale_items.map((i: any) => (
                  <div key={i.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{i.medicines?.name} {i.medicines?.strength}</p>
                      <p className="text-xs text-ink-muted">Sold {i.quantity} × {money(i.unit_price)} · {i.returnable} returnable</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-brand-600" checked={!!restock[i.id]} onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })} /> Back to stock</label>
                      <input type="number" min={0} max={i.returnable} disabled={i.returnable === 0} className="input w-20 py-1.5 text-center" value={qty[i.id] || ''} placeholder="0"
                        onChange={(e) => setQty({ ...qty, [i.id]: Math.max(0, Math.min(i.returnable, Number(e.target.value) || 0)) })} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className="label">Refund to</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {['cash', 'card', 'insurance', 'bill'].map((m) => {
                      const disabled = m === 'bill' && !sale.invoice_id;
                      return <button key={m} type="button" disabled={disabled} onClick={() => setMethod(m)} className={cn('rounded-lg py-2 text-xs font-semibold ring-1 disabled:opacity-40', method === m ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-200')}>{m === 'bill' ? 'Patient bill' : titleCase(m)}</button>;
                    })}
                  </div>
                  {method === 'card' && <p className="mt-1.5 text-xs text-ink-muted">{cardPayment && terminalEnabled ? 'Refund goes back to the original card automatically.' : 'Refund the card manually on your card machine.'}</p>}
                  {method === 'bill' && <p className="mt-1.5 text-xs text-ink-muted">A credit line is added to the patient&apos;s bill.</p>}
                </div>
                <label className="block"><span className="label">Reason</span><textarea className="input min-h-[84px]" placeholder="Wrong item, side effects, unopened..." value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-sm">Refund: <b className="text-lg">{money(estimate)}</b></span>
                <button className="btn-primary" disabled={busy || lines.length === 0} onClick={process}>{busy && <Spinner />} Process refund</button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
