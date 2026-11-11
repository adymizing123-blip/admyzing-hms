'use client';
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, Alert, Spinner } from '@/components/ui';
import Receipt from './Receipt';
import { cn, fmtDateTime, money, titleCase } from '@/lib/utils';

export function OpenShiftModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [cash, setCash] = useState('100.00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    const { error } = await createClient().rpc('pos_open_shift', { p_opening_cash: Number(cash) || 0 });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone(); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Open shift">
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <p className="text-sm text-ink-soft">Count the cash in the drawer before you start selling.</p>
        <label className="block"><span className="label">Opening cash in drawer ($)</span><input className="input text-lg" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /></label>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={go}>{busy && <Spinner />} Open shift</button></div>
      </div>
    </Modal>
  );
}

export function CashMovementModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    const { error } = await createClient().rpc('pos_cash_movement', { p_type: type, p_amount: Number(amount), p_reason: reason });
    setBusy(false);
    if (error) return setErr(error.message);
    setAmount(''); setReason('');
    onDone(); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Cash in / out">
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div className="grid grid-cols-2 gap-2">
          {(['out', 'in'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={cn('rounded-xl py-2.5 text-sm font-semibold ring-1', type === t ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-200')}>
              {t === 'out' ? 'Cash out (paid out)' : 'Cash in (added)'}
            </button>
          ))}
        </div>
        <label className="block"><span className="label">Amount ($)</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="block"><span className="label">Reason</span><input className="input" placeholder={type === 'out' ? 'e.g. Courier, petty cash, bank drop' : 'e.g. Extra change float'} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !(Number(amount) > 0) || !reason} onClick={go}>{busy && <Spinner />} Save</button></div>
      </div>
    </Modal>
  );
}

/** Close shift with counted cash. Shows the X-report (live) before closing and the Z-report after. */
export function CloseShiftModal({ open, onClose, onDone, shift }: { open: boolean; onClose: () => void; onDone: () => void; shift: any }) {
  const supabase = createClient();
  const [summary, setSummary] = useState<any>(null);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [closed, setClosed] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || !shift) return;
    setClosed(null); setErr(''); setCounted(''); setNotes('');
    supabase.rpc('pos_shift_summary', { p_shift: shift.id }).then(({ data, error }) => (error ? setErr(error.message) : setSummary(data)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shift?.id]);

  const close = async () => {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('pos_close_shift', { p_counted_cash: Number(counted) || 0, p_notes: notes || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setClosed({ ...data, counted: Number(counted) || 0 });
    onDone();
  };

  const s = closed || summary;
  const diff = s ? (closed ? closed.counted : Number(counted) || 0) - Number(s.expected_cash) : 0;

  return (
    <Modal open={open} onClose={onClose} title={closed ? 'Shift closed' : 'Close shift'}>
      {!s ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <ShiftReport s={s} counted={closed ? closed.counted : counted === '' ? null : Number(counted)} closed={!!closed} />
          {!closed ? (
            <div className="no-print space-y-3 border-t border-slate-100 pt-4">
              <label className="block"><span className="label">Cash counted in drawer ($)</span><input className="input text-lg" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus /></label>
              {counted !== '' && (
                <p className={cn('text-sm font-semibold', Math.abs(diff) < 0.005 ? 'text-emerald-700' : 'text-rose-600')}>
                  {Math.abs(diff) < 0.005 ? 'Drawer balances exactly.' : diff > 0 ? `Over by ${money(diff)}` : `Short by ${money(-diff)}`}
                </p>
              )}
              <label className="block"><span className="label">Notes</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
              <div className="flex justify-end gap-2">
                <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print X-report</button>
                <button className="btn-primary" disabled={busy || counted === ''} onClick={close}>{busy && <Spinner />} Close shift</button>
              </div>
            </div>
          ) : (
            <div className="no-print flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Done</button><button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print Z-report</button></div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function ShiftReport({ s, counted, closed }: { s: any; counted: number | null; closed?: boolean }) {
  const pays = Object.entries(s.payments || {}) as [string, number][];
  const refunds = Object.entries(s.refunds || {}) as [string, number][];
  const diff = counted == null ? null : counted - Number(s.expected_cash);
  return (
    <Receipt
      title={`${closed ? 'Z-REPORT' : 'X-REPORT'} · ${s.shift_no}`}
      meta={[`Opened ${fmtDateTime(s.opened_at)}`, ...(s.closed_at ? [`Closed ${fmtDateTime(s.closed_at)}`] : [])]}
      totals={[
        { label: 'Sales', value: String(s.sales_count) },
        { label: 'Gross sales', value: money(s.gross_sales) },
        { label: 'Discounts', value: money(s.discounts) },
        { label: 'Tax collected', value: money(s.tax) },
        { label: '--- Payments', value: '' },
        ...pays.map(([m, v]) => ({ label: titleCase(m === 'bill' ? 'patient bill' : m), value: money(v) })),
        { label: `--- Refunds (${s.returns_count})`, value: '' },
        ...refunds.map(([m, v]) => ({ label: titleCase(m === 'bill' ? 'patient bill' : m), value: `-${money(v)}` })),
        { label: '--- Cash drawer', value: '' },
        { label: 'Opening cash', value: money(s.opening_cash) },
        { label: 'Cash in', value: money(s.cash_in) },
        { label: 'Cash out', value: Number(s.cash_out) > 0 ? `-${money(s.cash_out)}` : money(0) },
        { label: 'Expected cash', value: money(s.expected_cash), bold: true },
        ...(counted != null ? [{ label: 'Counted cash', value: money(counted), bold: true }, { label: 'Difference', value: `${diff! >= 0 ? '+' : ''}${money(diff)}`, bold: true }] : []),
      ]}
    />
  );
}
