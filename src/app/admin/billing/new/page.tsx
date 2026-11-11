'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, Alert, Spinner } from '@/components/ui';
import PatientPicker, { type PickedPatient } from '@/components/admin/PatientPicker';
import { money } from '@/lib/utils';

const CATS = ['consultation', 'lab', 'pharmacy', 'room', 'procedure', 'other'];
const blank = { category: 'other', description: '', quantity: '1', unit_price: '' };

function NewInvoice() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [lines, setLines] = useState<any[]>([{ ...blank }]);
  const [discount, setDiscount] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [notes, setNotes] = useState('');
  const [due, setDue] = useState('');
  const [doctors, setDoctors] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('doctors').select('id, full_name, consultation_fee').order('full_name').then(({ data }) => setDoctors(data || []));
    supabase.from('lab_tests').select('id, name, price').eq('active', true).order('name').then(({ data }) => setTests(data || []));
    const pid = params.get('patient');
    if (pid) supabase.from('patients').select('id, first_name, last_name, mrn, phone').eq('id', pid).single().then(({ data }) => data && setPatient(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLine = (l: any) => setLines((x) => [...x.filter((y) => y.description || y.unit_price), l]);
  const subtotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
  const disc = Number(discount) || 0;
  const tax = Math.round((subtotal - disc) * Number(taxRate || 0)) / 100;

  const save = async () => {
    const valid = lines.filter((l) => l.description && Number(l.unit_price) >= 0 && l.unit_price !== '');
    if (!patient) return setErr('Select a patient');
    if (!valid.length) return setErr('Add at least one line item');
    setBusy(true);
    const { data: inv, error } = await supabase.from('invoices').insert({ patient_id: patient.id, notes: notes || null, due_date: due || null }).select().single();
    if (error) { setBusy(false); return setErr(error.message); }
    await supabase.from('invoice_items').insert(valid.map((l) => ({ invoice_id: inv.id, category: l.category, description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })));
    if (disc || tax) await supabase.from('invoices').update({ discount: disc, tax }).eq('id', inv.id);
    router.push(`/admin/billing/${inv.id}`);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New invoice" />
      <div className="space-y-5">
        {err && <Alert>{err}</Alert>}
        <div className="card p-5"><span className="label">Patient</span><PatientPicker value={patient} onChange={setPatient} /></div>

        <div className="card p-5">
          <div className="mb-3 flex flex-wrap gap-2">
            <select className="input w-auto py-2 text-sm" value="" onChange={(e) => { const d = doctors.find((x) => x.id === e.target.value); if (d) addLine({ category: 'consultation', description: `Consultation: ${d.full_name}`, quantity: '1', unit_price: String(d.consultation_fee) }); }}>
              <option value="">+ Consultation fee</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({money(d.consultation_fee)})</option>)}
            </select>
            <select className="input w-auto py-2 text-sm" value="" onChange={(e) => { const t = tests.find((x) => x.id === e.target.value); if (t) addLine({ category: 'lab', description: t.name, quantity: '1', unit_price: String(t.price) }); }}>
              <option value="">+ Lab test</option>{tests.map((t) => <option key={t.id} value={t.id}>{t.name} ({money(t.price)})</option>)}
            </select>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="input col-span-6 sm:col-span-2" value={l.category} onChange={(e) => { const n = [...lines]; n[i] = { ...l, category: e.target.value }; setLines(n); }}>
                  {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input className="input col-span-6 sm:col-span-5" placeholder="Description" value={l.description} onChange={(e) => { const n = [...lines]; n[i] = { ...l, description: e.target.value }; setLines(n); }} />
                <input className="input col-span-3 sm:col-span-1" placeholder="Qty" value={l.quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...l, quantity: e.target.value }; setLines(n); }} />
                <input className="input col-span-5 sm:col-span-2" placeholder="Price" value={l.unit_price} onChange={(e) => { const n = [...lines]; n[i] = { ...l, unit_price: e.target.value }; setLines(n); }} />
                <span className="col-span-3 self-center text-right text-sm font-semibold sm:col-span-1">{money(Number(l.quantity || 0) * Number(l.unit_price || 0))}</span>
                <button className="btn-ghost col-span-1 px-0 text-rose-600" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <button className="btn-secondary btn-sm mt-3" onClick={() => setLines([...lines, { ...blank }])}><Plus size={14} /> Add line</button>
        </div>

        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <label className="block"><span className="label">Notes</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            <label className="block"><span className="label">Due date</span><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2"><span>Discount ($)</span><input className="input w-28 py-1.5 text-right" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
            <div className="flex items-center justify-between gap-2"><span>Tax (%)</span><input className="input w-28 py-1.5 text-right" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-lg font-extrabold"><span>Total</span><span>{money(subtotal - disc + tax)}</span></div>
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Spinner />} Create invoice</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() { return <Suspense><NewInvoice /></Suspense>; }
