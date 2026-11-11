'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Printer, Plus, Trash2, ShieldCheck, Ban } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, StatusBadge, Alert, Spinner } from '@/components/ui';
import { DEFAULT_HOSPITAL } from '@/lib/settings';
import { fmtDate, fmtDateTime, fullName, money, titleCase } from '@/lib/utils';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [inv, setInv] = useState<any>(null);
  const [h, setH] = useState<any>(DEFAULT_HOSPITAL);
  const [modal, setModal] = useState<'' | 'pay' | 'item' | 'claim' | 'adjust'>('');
  const [pay, setPay] = useState({ amount: '', method: 'cash', reference: '' });
  const [item, setItem] = useState({ category: 'other', description: '', quantity: '1', unit_price: '', code: '' });
  const [claim, setClaim] = useState({ provider: '', payer_id: '', member_id: '', diagnosis_codes: '', amount: '' });
  const [adj, setAdj] = useState({ discount: '', tax: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('invoices')
      .select('*, patients(*), invoice_items(*), payments(*), insurance_claims(*)')
      .eq('id', id).single();
    setInv(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
    supabase.from('settings').select('value').eq('key', 'hospital').maybeSingle().then(({ data }) => data && setH({ ...DEFAULT_HOSPITAL, ...data.value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const run = async (fn: () => PromiseLike<{ error: any }>) => {
    setBusy(true); setErr('');
    const { error } = await fn();
    setBusy(false);
    if (error) return setErr(error.message);
    setModal(''); load();
  };

  if (!inv) return <div className="flex justify-center py-20"><Spinner /></div>;
  const p = inv.patients;
  const balance = Number(inv.total) - Number(inv.amount_paid);
  const locked = inv.status === 'void';

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/admin/billing" className="no-print text-sm font-semibold text-brand-700">← Billing</Link>

      <div className="no-print flex flex-wrap gap-2">
        {!locked && balance > 0 && <button className="btn-primary" onClick={() => { setPay({ amount: balance.toFixed(2), method: 'cash', reference: '' }); setModal('pay'); setErr(''); }}>Record payment</button>}
        {!locked && <button className="btn-secondary" onClick={() => { setModal('item'); setErr(''); }}><Plus size={16} /> Add item</button>}
        {!locked && <button className="btn-secondary" onClick={() => { setAdj({ discount: String(inv.discount), tax: String(inv.tax) }); setModal('adjust'); setErr(''); }}>Discount / tax</button>}
        {!locked && p?.insurance_provider && <button className="btn-secondary" onClick={async () => {
          const { data: v } = await supabase.from('visits').select('icd10_codes').eq('patient_id', p.id).not('icd10_codes', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
          setClaim({ provider: p.insurance_provider, payer_id: '', member_id: p.insurance_member_id || '', diagnosis_codes: v?.icd10_codes || '', amount: balance.toFixed(2) }); setModal('claim'); setErr('');
        }}><ShieldCheck size={16} /> Insurance claim</button>}
        <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print</button>
        {!locked && Number(inv.amount_paid) === 0 && <button className="btn-ghost text-rose-600" onClick={() => confirm('Void this invoice?') && run(() => supabase.from('invoices').update({ status: 'void' }).eq('id', id))}><Ban size={16} /> Void</button>}
      </div>

      <div className="print-area card p-6 sm:p-10">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row">
          <div>
            <p className="text-2xl font-extrabold text-brand-700">{h.name}</p>
            <p className="text-sm text-ink-soft">{h.address}</p>
            <p className="text-sm text-ink-soft">{h.phone} · {h.email}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Invoice</p>
            <p className="text-xl font-bold">{inv.invoice_no}</p>
            <p className="text-sm text-ink-soft">Date: {fmtDate(inv.created_at)}</p>
            {inv.due_date && <p className="text-sm text-ink-soft">Due: {fmtDate(inv.due_date)}</p>}
            <div className="mt-2"><StatusBadge status={inv.status} /></div>
          </div>
        </div>

        <div className="grid gap-4 py-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Bill to</p>
            <p className="mt-1 font-semibold">{fullName(p)}</p>
            <p className="text-ink-soft">MRN {p?.mrn}</p>
            {p?.address && <p className="text-ink-soft">{[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')}</p>}
          </div>
          {p?.insurance_provider && (
            <div className="sm:text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Insurance</p>
              <p className="mt-1">{p.insurance_provider}</p>
              <p className="text-ink-soft">Member ID {p.insurance_member_id}</p>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-y border-slate-200 bg-slate-50"><tr><th className="th">Description</th><th className="th">Code</th><th className="th">Type</th><th className="th text-right">Qty</th><th className="th text-right">Price</th><th className="th text-right">Amount</th><th className="th no-print" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {inv.invoice_items.map((i: any) => (
                <tr key={i.id}>
                  <td className="td whitespace-normal font-medium">{i.description}</td>
                  <td className="td font-mono text-xs text-ink-soft">{i.code || '-'}</td>
                  <td className="td text-ink-soft">{titleCase(i.category)}</td>
                  <td className="td text-right">{Number(i.quantity)}</td>
                  <td className="td text-right">{money(i.unit_price)}</td>
                  <td className="td text-right font-semibold">{money(i.line_total)}</td>
                  <td className="td no-print text-right">{!locked && <button className="text-rose-600" onClick={() => run(() => supabase.from('invoice_items').delete().eq('id', i.id))} aria-label="Remove"><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-6 w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span>{money(inv.subtotal)}</span></div>
          {Number(inv.discount) > 0 && <div className="flex justify-between"><span className="text-ink-soft">Discount</span><span>-{money(inv.discount)}</span></div>}
          {Number(inv.tax) > 0 && <div className="flex justify-between"><span className="text-ink-soft">Tax</span><span>{money(inv.tax)}</span></div>}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><span>Total</span><span>{money(inv.total)}</span></div>
          <div className="flex justify-between"><span className="text-ink-soft">Paid</span><span>{money(inv.amount_paid)}</span></div>
          <div className="flex justify-between text-base font-extrabold text-brand-700"><span>Balance due</span><span>{money(balance)}</span></div>
        </div>

        {inv.payments.length > 0 && (
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Payments</p>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {inv.payments.map((x: any) => <li key={x.id} className="flex justify-between py-2"><span>{fmtDateTime(x.created_at)} · <span className="capitalize">{x.method}</span>{x.reference ? ` · ${x.reference}` : ''}</span><span className="font-semibold">{money(x.amount)}</span></li>)}
            </ul>
          </div>
        )}
        {inv.insurance_claims.length > 0 && (
          <div className="no-print mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Insurance claims</p>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {inv.insurance_claims.map((c: any) => <li key={c.id}><Link href={`/admin/billing/claims/${c.id}`} className="flex items-center justify-between py-2 hover:text-brand-700"><span>{c.provider} {c.claim_no && `· ${c.claim_no}`}</span><span className="flex items-center gap-2">{money(c.amount)} <StatusBadge status={c.status} /></span></Link></li>)}
            </ul>
          </div>
        )}
        <p className="mt-10 text-center text-xs text-ink-muted">Thank you for choosing {h.name}.</p>
      </div>

      <Modal open={modal === 'pay'} onClose={() => setModal('')} title="Record payment">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <label className="block"><span className="label">Amount ($)</span><input className="input" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
          <label className="block"><span className="label">Method</span><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['cash', 'card', 'check', 'insurance', 'stripe', 'other'].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</select></label>
          <label className="block"><span className="label">Reference (last 4 / check no.)</span><input className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={async () => { const { data: { user } } = await supabase.auth.getUser(); run(() => supabase.from('payments').insert({ invoice_id: id, amount: Number(pay.amount), method: pay.method, reference: pay.reference || null, received_by: user?.id })); }}>{busy && <Spinner />} Save payment</button></div>
        </div>
      </Modal>

      <Modal open={modal === 'item'} onClose={() => setModal('')} title="Add line item">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <label className="block"><span className="label">Type</span><select className="input" value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value })}>{['consultation', 'lab', 'pharmacy', 'room', 'procedure', 'other'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label>
          <label className="block"><span className="label">Description</span><input className="input" value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} /></label>
          <label className="block"><span className="label">CPT / HCPCS code (optional)</span><input className="input" value={item.code} onChange={(e) => setItem({ ...item, code: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Qty</span><input className="input" value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} /></label>
            <label className="block"><span className="label">Unit price ($)</span><input className="input" value={item.unit_price} onChange={(e) => setItem({ ...item, unit_price: e.target.value })} /></label>
          </div>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button>
            <button className="btn-primary" disabled={busy || !item.description} onClick={() => run(() => supabase.from('invoice_items').insert({ invoice_id: id, ...item, code: item.code || null, quantity: Number(item.quantity), unit_price: Number(item.unit_price) }))}>{busy && <Spinner />} Add</button></div>
        </div>
      </Modal>

      <Modal open={modal === 'adjust'} onClose={() => setModal('')} title="Discount & tax">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <label className="block"><span className="label">Discount ($)</span><input className="input" value={adj.discount} onChange={(e) => setAdj({ ...adj, discount: e.target.value })} /></label>
          <label className="block"><span className="label">Tax amount ($)</span><input className="input" value={adj.tax} onChange={(e) => setAdj({ ...adj, tax: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={() => run(() => supabase.from('invoices').update({ discount: Number(adj.discount) || 0, tax: Number(adj.tax) || 0 }).eq('id', id))}>{busy && <Spinner />} Save</button></div>
        </div>
      </Modal>

      <Modal open={modal === 'claim'} onClose={() => setModal('')} title="New insurance claim">
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          {([['provider', 'Insurance company'], ['payer_id', 'Payer ID (from your clearinghouse list)'], ['member_id', 'Member ID'], ['diagnosis_codes', 'ICD-10 diagnosis codes (comma separated)'], ['amount', 'Claim amount ($)']] as const).map(([k, l]) => (
            <label key={k} className="block"><span className="label">{l}</span><input className="input" value={claim[k]} onChange={(e) => setClaim({ ...claim, [k]: e.target.value })} /></label>
          ))}
          {inv.invoice_items.some((i: any) => !i.code) && <Alert tone="amber">Some lines have no CPT code. Most insurers reject claim lines without one. Add codes before submitting.</Alert>}
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setModal('')}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={() => async () => {
              setBusy(true); setErr('');
              const { data, error } = await supabase.from('insurance_claims').insert({ invoice_id: id, ...claim, amount: Number(claim.amount) }).select('id').single();
              setBusy(false);
              if (error) return setErr(error.message);
              window.location.href = `/admin/billing/claims/${data.id}`;
            }}>{busy && <Spinner />} Create claim</button></div>
        </div>
      </Modal>
    </div>
  );
}
