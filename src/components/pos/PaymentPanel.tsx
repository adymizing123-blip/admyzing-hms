'use client';
import { useEffect, useRef, useState } from 'react';
import { Banknote, CreditCard, ShieldCheck, Receipt as ReceiptIcon, X, Loader2, Smartphone } from 'lucide-react';
import { cn, money } from '@/lib/utils';

export type Payment = { method: 'cash' | 'card' | 'insurance' | 'bill'; amount: string; reference: string; readerPaid?: boolean };

const METHODS = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'insurance', label: 'Insurance', icon: ShieldCheck },
  { id: 'bill', label: 'Patient bill', icon: ReceiptIcon },
] as const;

/** Split-payment editor. Cash may be over-tendered (change is shown). Card can be sent to a Stripe Terminal reader. */
export default function PaymentPanel({ total, payments, setPayments, hasPatient, terminal, saleLabel }: {
  total: number;
  payments: Payment[];
  setPayments: (p: Payment[]) => void;
  hasPatient: boolean;
  terminal: { enabled: boolean; simulated: boolean };
  saleLabel: string;
}) {
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
  const change = Math.max(0, Math.round((paid - total) * 100) / 100);

  const add = (method: Payment['method']) => {
    const amt = remaining > 0 ? remaining.toFixed(2) : '';
    const existing = payments.findIndex((p) => p.method === method && !p.readerPaid);
    if (existing >= 0) {
      const n = [...payments];
      n[existing] = { ...n[existing], amount: (Number(n[existing].amount || 0) + Number(amt || 0)).toFixed(2) };
      setPayments(n);
    } else setPayments([...payments, { method, amount: amt, reference: '' }]);
  };

  const update = (i: number, patch: Partial<Payment>) => { const n = [...payments]; n[i] = { ...n[i], ...patch }; setPayments(n); };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        {METHODS.map((m) => {
          const disabled = m.id === 'bill' && !hasPatient;
          return (
            <button key={m.id} type="button" disabled={disabled} onClick={() => add(m.id)} title={disabled ? 'Link a patient first' : ''}
              className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-semibold ring-1 ring-slate-200 transition hover:bg-brand-50 hover:ring-brand-300 disabled:opacity-40">
              <m.icon size={16} /> {m.label}
            </button>
          );
        })}
      </div>

      {payments.map((p, i) => (
        <PaymentRow key={i} p={p} terminal={terminal} saleLabel={saleLabel}
          onChange={(patch) => update(i, patch)} onRemove={() => setPayments(payments.filter((_, j) => j !== i))} />
      ))}

      {payments.length > 0 && (
        <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          {remaining > 0 ? <><span className="text-rose-600">Remaining</span><span className="font-bold text-rose-600">{money(remaining)}</span></>
            : change > 0 ? <><span className="text-emerald-700">Change due</span><span className="font-bold text-emerald-700">{money(change)}</span></>
              : <><span className="text-emerald-700">Fully paid</span><span className="font-bold text-emerald-700">✓</span></>}
        </div>
      )}
    </div>
  );
}

function PaymentRow({ p, onChange, onRemove, terminal, saleLabel }: {
  p: Payment; onChange: (patch: Partial<Payment>) => void; onRemove: () => void; terminal: { enabled: boolean; simulated: boolean }; saleLabel: string;
}) {
  const [state, setState] = useState<'idle' | 'waiting' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const piRef = useRef<string | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => () => clearInterval(timer.current), []);

  const sendToReader = async () => {
    setState('waiting'); setMsg('Ask the customer to tap, insert or swipe their card.');
    const res = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'charge', amount: p.amount, description: saleLabel }) });
    const data = await res.json();
    if (!res.ok) { setState('error'); setMsg(data.error); return; }
    piRef.current = data.payment_intent;
    timer.current = setInterval(async () => {
      const r = await fetch(`/api/terminal?pi=${piRef.current}`);
      const s = await r.json();
      if (s.status === 'succeeded') {
        clearInterval(timer.current);
        setState('idle'); setMsg('');
        onChange({ reference: piRef.current!, readerPaid: true });
      } else if (s.error) {
        clearInterval(timer.current);
        setState('error'); setMsg(s.error);
      }
    }, 2000);
  };

  const cancel = async () => {
    clearInterval(timer.current);
    await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });
    setState('idle'); setMsg('');
  };

  const simulate = () => fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'simulate' }) });

  const label = { cash: 'Cash tendered', card: 'Card', insurance: 'Insurance', bill: 'Patient bill' }[p.method];
  const refPlaceholder = { cash: '', card: 'Last 4 digits', insurance: 'Claim / auth #', bill: '' }[p.method];

  return (
    <div className={cn('rounded-xl p-2.5 ring-1', p.readerPaid ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-200')}>
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-xs font-semibold">{label}</span>
        <input className="input w-full py-1.5 text-right" inputMode="decimal" value={p.amount} disabled={p.readerPaid || state === 'waiting'}
          onChange={(e) => onChange({ amount: e.target.value })} />
        {!p.readerPaid && state !== 'waiting' && <button type="button" className="p-1 text-ink-muted hover:text-rose-600" onClick={onRemove} aria-label="Remove payment"><X size={16} /></button>}
      </div>
      {refPlaceholder && !p.readerPaid && (
        <div className="mt-2 flex gap-2">
          <input className="input py-1.5 text-xs" placeholder={refPlaceholder} value={p.reference} disabled={state === 'waiting'} onChange={(e) => onChange({ reference: e.target.value })} />
          {p.method === 'card' && terminal.enabled && state !== 'waiting' && (
            <button type="button" className="btn-primary btn-sm whitespace-nowrap" disabled={!(Number(p.amount) > 0)} onClick={sendToReader}><Smartphone size={13} /> Send to reader</button>
          )}
        </div>
      )}
      {p.readerPaid && <p className="mt-1.5 text-xs font-semibold text-emerald-700">Approved on card reader</p>}
      {state === 'waiting' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <Loader2 size={14} className="animate-spin text-brand-600" /> {msg}
          <button type="button" className="font-semibold text-rose-600" onClick={cancel}>Cancel</button>
          {terminal.simulated && <button type="button" className="font-semibold text-brand-700" onClick={simulate}>Simulate tap (test mode)</button>}
        </div>
      )}
      {state === 'error' && <p className="mt-1.5 text-xs text-rose-600">{msg} <button type="button" className="font-semibold underline" onClick={() => setState('idle')}>Try again</button></p>}
    </div>
  );
}
