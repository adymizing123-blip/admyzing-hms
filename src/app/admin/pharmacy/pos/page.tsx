'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Minus, Plus, Trash2, Printer, ShoppingCart, CheckCircle2, Undo2, Wallet, Lock, Unlock, AlertTriangle, FileCheck2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner, Badge, Modal } from '@/components/ui';
import PatientPicker, { type PickedPatient } from '@/components/admin/PatientPicker';
import PaymentPanel, { type Payment } from '@/components/pos/PaymentPanel';
import ReturnsModal from '@/components/pos/ReturnsModal';
import { OpenShiftModal, CashMovementModal, CloseShiftModal } from '@/components/pos/ShiftModals';
import Receipt, { now, paymentLines } from '@/components/pos/Receipt';
import { cn, fmtTime, fullName, money } from '@/lib/utils';
import { DEFAULT_HOSPITAL } from '@/lib/settings';

type Line = { id: string; name: string; price: number; stock: number; qty: number; rx: boolean };

export default function POS() {
  const supabase = createClient();
  const [meds, setMeds] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [rxOnFile, setRxOnFile] = useState<Set<string>>(new Set());
  const [rxNote, setRxNote] = useState('');
  const [discount, setDiscount] = useState('');
  const [taxRate, setTaxRate] = useState(DEFAULT_HOSPITAL.tax_rate);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [receipt, setReceipt] = useState<any>(null);
  const [shift, setShift] = useState<any>(undefined);
  const [modal, setModal] = useState<'' | 'open' | 'cash' | 'close' | 'returns'>('');
  const [terminal, setTerminal] = useState({ enabled: false, simulated: false });
  const searchRef = useRef<HTMLInputElement>(null);
  const [cartVisible, setCartVisible] = useState(false);

  // hide the mobile "View sale" button once the cart is on screen
  useEffect(() => {
    const el = document.getElementById('pos-cart');
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setCartVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [shift]);

  const loadMeds = async () => {
    const { data } = await supabase.from('medicine_stock').select('*').eq('active', true).order('name');
    setMeds(data || []);
  };

  const loadShift = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase.from('pos_shifts').select('*').eq('cashier_id', user?.id).eq('status', 'open').maybeSingle();
    setShift(data || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMeds();
    loadShift();
    supabase.from('settings').select('value').eq('key', 'hospital').maybeSingle().then(({ data }) => data?.value?.tax_rate != null && setTaxRate(Number(data.value.tax_rate)));
    fetch('/api/terminal').then((r) => (r.ok ? r.json() : null)).then((d) => d && setTerminal(d)).catch(() => {});
    searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // prescriptions on file for the linked patient (last 180 days)
  useEffect(() => {
    setRxOnFile(new Set());
    if (!patient) return;
    const since = new Date(Date.now() - 180 * 864e5).toISOString();
    supabase.from('visits').select('prescriptions(medicine_id, medicine_name)').eq('patient_id', patient.id).gte('created_at', since)
      .then(({ data }) => {
        const ids = new Set<string>();
        (data || []).forEach((v: any) => v.prescriptions.forEach((p: any) => {
          if (p.medicine_id) ids.add(p.medicine_id);
          const m = meds.find((x) => p.medicine_name?.toLowerCase().startsWith(x.name.toLowerCase()));
          if (m) ids.add(m.id);
        }));
        setRxOnFile(ids);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient, meds.length]);

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return meds;
    return meds.filter((m) => [m.name, m.generic_name, m.sku, m.barcode, m.category].some((x) => (x || '').toLowerCase().includes(t)));
  }, [q, meds]);

  const add = (m: any) => {
    setErr('');
    if (m.stock <= 0) return setErr(`${m.name} is out of stock`);
    setCart((c) => {
      const ex = c.find((l) => l.id === m.id);
      if (ex) return c.map((l) => (l.id === m.id ? { ...l, qty: Math.min(l.qty + 1, m.stock) } : l));
      return [...c, { id: m.id, name: `${m.name} ${m.strength || ''}`.trim(), price: Number(m.price), stock: m.stock, qty: 1, rx: m.requires_prescription }];
    });
  };

  // barcode scanners type the code then press Enter
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const exact = meds.find((m) => m.barcode === q.trim() || m.sku === q.trim());
    const pick = exact || (filtered.length === 1 ? filtered[0] : null);
    if (pick) { add(pick); setQ(''); }
  };

  const setQty = (id: string, qty: number) => setCart((c) => c.flatMap((l) => (l.id !== id ? [l] : qty <= 0 ? [] : [{ ...l, qty: Math.min(qty, l.stock) }])));

  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const tax = Math.round((subtotal - disc) * taxRate) / 100;
  const total = Math.round((subtotal - disc + tax) * 100) / 100;
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const cashPaid = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const overTender = paid - total;

  const rxLines = cart.filter((l) => l.rx);
  const rxMissing = rxLines.filter((l) => !rxOnFile.has(l.id));
  const rxOk = rxMissing.length === 0 || rxNote.trim().length > 0;
  const payOk = cart.length > 0 && paid >= total - 0.001 && overTender <= cashPaid + 0.001;
  const readerPending = payments.some((p) => p.method === 'card' && terminal.enabled && !p.readerPaid && !p.reference);

  const checkout = async () => {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('pos_checkout', {
      p_items: cart.map((l) => ({ medicine_id: l.id, quantity: l.qty })),
      p_payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) || 0, reference: p.reference || null })),
      p_patient_id: patient?.id || null, p_discount: disc, p_tax_rate: taxRate, p_rx_note: rxNote || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setReceipt({ ...data, lines: cart, subtotal, disc, tax, total, payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ ...p, amount: Number(p.amount) })), patient, rxNote });
    setCart([]); setDiscount(''); setPatient(null); setPayments([]); setRxNote('');
    loadMeds();
  };

  const noShift = shift === null;

  return (
    <div>
      {/* Shift bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Pharmacy POS</h1>
          {shift && <p className="text-sm text-ink-soft"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />Shift {shift.shift_no} open since {fmtTime(shift.opened_at)} · float {money(shift.opening_cash)}</p>}
          {noShift && <p className="text-sm text-ink-soft"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-300" />No open shift</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" disabled={!shift} onClick={() => setModal('returns')}><Undo2 size={14} /> Returns</button>
          <button className="btn-secondary btn-sm" disabled={!shift} onClick={() => setModal('cash')}><Wallet size={14} /> Cash in / out</button>
          {shift ? <button className="btn-secondary btn-sm" onClick={() => setModal('close')}><Lock size={14} /> Close shift</button>
            : <button className="btn-primary btn-sm" disabled={shift === undefined} onClick={() => setModal('open')}><Unlock size={14} /> Open shift</button>}
        </div>
      </div>

      {noShift && (
        <div className="card mb-5 flex flex-col items-start gap-3 border-amber-200 bg-amber-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold">Open a shift to start selling</p><p className="text-sm text-ink-soft">Count your opening cash. Every sale, refund and cash movement is tracked against your shift.</p></div>
          <button className="btn-primary" onClick={() => setModal('open')}><Unlock size={16} /> Open shift</button>
        </div>
      )}

      <div className={cn('grid gap-5 lg:grid-cols-5', noShift && 'pointer-events-none opacity-50')}>
        <div className="lg:col-span-3">
          <div className="relative mb-4">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input ref={searchRef} className="input py-3 pl-10 text-base" placeholder="Scan barcode or search medicine..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((m) => (
              <button key={m.id} onClick={() => add(m)} disabled={m.stock <= 0}
                className={cn('card flex flex-col p-3 text-left transition hover:border-brand-300 active:scale-[.98]', m.stock <= 0 && 'opacity-50')}>
                <p className="line-clamp-2 text-sm font-semibold leading-tight">{m.name}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{m.strength} {m.form}</p>
                <div className="mt-auto flex items-end justify-between pt-3">
                  <span className="font-bold text-brand-700">{money(m.price)}</span>
                  <span className={cn('text-[11px] font-semibold', m.stock <= m.reorder_level ? 'text-rose-600' : 'text-ink-muted')}>{m.stock} left</span>
                </div>
                {m.requires_prescription && <span className="mt-1.5"><Badge tone="violet">Rx</Badge></span>}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div id="pos-cart" className="card sticky top-20 flex scroll-mt-20 flex-col gap-3 p-4 sm:p-5">
            <div className="flex items-center gap-2 font-bold"><ShoppingCart size={18} className="text-brand-600" /> Current sale</div>
            {err && <Alert>{err}</Alert>}
            <PatientPicker value={patient} onChange={setPatient} placeholder="Link patient (optional)" />

            <div className="max-h-[32vh] min-h-[90px] space-y-2 overflow-y-auto">
              {cart.length === 0 && <p className="py-6 text-center text-sm text-ink-muted">Scan or tap a medicine to add it.</p>}
              {cart.map((l) => (
                <div key={l.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{l.name} {l.rx && <span className={cn('text-[10px]', rxOnFile.has(l.id) ? 'text-emerald-600' : 'text-violet-600')}>{rxOnFile.has(l.id) ? 'Rx on file' : 'Rx'}</span>}</p>
                    <p className="text-xs text-ink-muted">{money(l.price)} each</p>
                  </div>
                  <div className="flex items-center rounded-lg border border-slate-200 bg-white">
                    <button className="p-1.5" onClick={() => setQty(l.id, l.qty - 1)} aria-label="Decrease"><Minus size={13} /></button>
                    <input className="w-10 text-center text-sm font-semibold outline-none" value={l.qty} onChange={(e) => setQty(l.id, Number(e.target.value) || 0)} />
                    <button className="p-1.5" onClick={() => setQty(l.id, l.qty + 1)} aria-label="Increase"><Plus size={13} /></button>
                  </div>
                  <span className="w-16 text-right text-sm font-bold">{money(l.qty * l.price)}</span>
                  <button className="p-1 text-rose-600" onClick={() => setQty(l.id, 0)} aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            {/* Prescription check */}
            {rxLines.length > 0 && (
              rxMissing.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><FileCheck2 size={15} /> Prescription on file for all Rx items</div>
              ) : (
                <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                  <p className="flex items-start gap-2 text-xs font-semibold text-violet-800"><AlertTriangle size={15} className="mt-px shrink-0" />
                    Prescription needed for {rxMissing.map((l) => l.name).join(', ')}. {patient ? 'None on file for this patient.' : 'Link the patient to check their prescriptions,'} or enter the prescription details.</p>
                  <input className="input py-1.5 text-xs" placeholder="e.g. Rx #4471 from Dr. Lee, Austin Family Clinic, 11/02" value={rxNote} onChange={(e) => setRxNote(e.target.value)} />
                </div>
              )
            )}

            <div className="space-y-1.5 border-t border-slate-100 pt-3 text-sm">
              <div className="flex justify-between"><span className="text-ink-soft">Subtotal</span><span>{money(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2"><span className="text-ink-soft">Discount ($)</span><input className="input w-24 py-1 text-right" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" /></div>
              <div className="flex justify-between"><span className="text-ink-soft">Sales tax ({taxRate}%)</span><span>{money(tax)}</span></div>
              <div className="flex justify-between pt-1 text-lg font-extrabold"><span>Total</span><span>{money(total)}</span></div>
            </div>

            {cart.length > 0 && (
              <PaymentPanel total={total} payments={payments} setPayments={setPayments} hasPatient={!!patient} terminal={terminal} saleLabel={`Pharmacy sale ${money(total)}`} />
            )}

            <button className="btn-primary py-3 text-base" disabled={!payOk || !rxOk || busy || readerPending} onClick={checkout}>
              {busy && <Spinner />} {payments.length === 0 ? 'Choose a payment method' : readerPending ? 'Waiting for card reader' : `Complete sale ${money(total)}`}
            </button>
          </div>
        </div>
      </div>

      {cart.length > 0 && !cartVisible && (
        <button className="btn-primary fixed inset-x-4 bottom-4 z-30 py-3.5 text-base shadow-xl lg:hidden"
          onClick={() => document.getElementById('pos-cart')?.scrollIntoView({ behavior: 'smooth' })}>
          <ShoppingCart size={18} /> View sale ({cart.reduce((s, l) => s + l.qty, 0)}) · {money(total)}
        </button>
      )}

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Sale complete">
        {receipt && (
          <div>
            <div className="no-print mb-4 space-y-1">
              <p className="flex items-center gap-2 font-semibold text-brand-700"><CheckCircle2 size={20} /> {receipt.sale_no} completed</p>
              {Number(receipt.change) > 0 && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-lg font-extrabold text-emerald-700">Give change: {money(receipt.change)}</p>}
              {receipt.invoice_id && <p className="text-sm text-ink-soft">The patient bill amount was added to their hospital invoice.</p>}
            </div>
            <Receipt
              title={`Receipt ${receipt.sale_no}`}
              meta={[now(), ...(receipt.patient ? [`Patient: ${fullName(receipt.patient)} (${receipt.patient.mrn})`] : [])]}
              items={receipt.lines.map((l: Line) => ({ name: l.name, qty: l.qty, amount: l.qty * l.price }))}
              totals={[
                { label: 'Subtotal', value: money(receipt.subtotal) },
                ...(receipt.disc > 0 ? [{ label: 'Discount', value: `-${money(receipt.disc)}` }] : []),
                { label: 'Tax', value: money(receipt.tax) },
                { label: 'TOTAL', value: money(receipt.total), bold: true },
                ...paymentLines(receipt.payments),
                ...(Number(receipt.change) > 0 ? [{ label: 'Change', value: money(receipt.change) }] : []),
              ]}
              footer={receipt.rxNote ? `Rx: ${receipt.rxNote}. Thank you, get well soon!` : 'Thank you, get well soon!'}
            />
            <div className="no-print mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setReceipt(null)}>New sale</button>
              <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print</button>
            </div>
          </div>
        )}
      </Modal>

      <OpenShiftModal open={modal === 'open'} onClose={() => setModal('')} onDone={loadShift} />
      <CashMovementModal open={modal === 'cash'} onClose={() => setModal('')} onDone={loadShift} />
      <CloseShiftModal open={modal === 'close'} onClose={() => { setModal(''); loadShift(); }} onDone={() => {}} shift={shift} />
      <ReturnsModal open={modal === 'returns'} onClose={() => setModal('')} onDone={loadMeds} terminalEnabled={terminal.enabled} />
    </div>
  );
}
