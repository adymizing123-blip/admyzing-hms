'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Play, CheckCircle2, Plus, Receipt, Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner, StatusBadge, Empty, Modal } from '@/components/ui';
import { age, fmtDateTime, fullName, money } from '@/lib/utils';

const ANESTHESIA = ['General', 'Spinal', 'Epidural', 'Regional block', 'Local', 'Sedation (MAC)'];

export default function OTDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [o, setO] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [doctors, setDoctors] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [meds, setMeds] = useState<any[]>([]);
  const [add, setAdd] = useState({ kind: 'item', id: '', qty: '1' });
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('ot_schedules')
      .select('*, patients(*), doctors!ot_schedules_doctor_id_fkey(full_name), ot_consumables(*), invoices(invoice_no, total, status)')
      .eq('id', id).single();
    setO(data);
    if (data) setF({
      anesthesia_type: data.anesthesia_type || '', anesthetist_id: data.anesthetist_id || '', pre_op_notes: data.pre_op_notes || '',
      anesthesia_notes: data.anesthesia_notes || '', operative_notes: data.operative_notes || '', post_op_notes: data.post_op_notes || '',
      complications: data.complications || '', blood_loss_ml: data.blood_loss_ml ?? '', procedure_fee: data.procedure_fee ?? 0, procedure_code: data.procedure_code || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
    supabase.from('doctors').select('id, full_name').order('full_name').then(({ data }) => setDoctors(data || []));
    supabase.from('inventory_items').select('id, name, quantity, unit, unit_price').order('name').then(({ data }) => setItems(data || []));
    supabase.from('medicine_stock').select('id, name, strength, stock, price').eq('active', true).order('name').then(({ data }) => setMeds(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const save = async (extra: any = {}) => {
    setBusy(true); setMsg(null);
    const payload = { ...f, anesthetist_id: f.anesthetist_id || null, blood_loss_ml: f.blood_loss_ml === '' ? null : Number(f.blood_loss_ml), procedure_fee: Number(f.procedure_fee) || 0, ...extra };
    Object.keys(payload).forEach((k) => payload[k] === '' && (payload[k] = null));
    const { error } = await supabase.from('ot_schedules').update(payload).eq('id', id);
    setBusy(false);
    setMsg(error ? { tone: 'red', text: error.message } : { tone: 'green', text: 'Saved.' });
    load();
  };

  const addConsumable = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('ot_add_consumable', {
      p_ot: id, p_item: add.kind === 'item' ? add.id : null, p_medicine: add.kind === 'med' ? add.id : null, p_qty: Number(add.qty) || 1,
    });
    setBusy(false);
    if (error) return alert(error.message);
    setAddOpen(false); setAdd({ kind: 'item', id: '', qty: '1' });
    load();
  };

  const bill = async () => {
    await save();
    const { data, error } = await supabase.rpc('ot_bill', { p_ot: id });
    if (error) return alert(error.message);
    router.push(`/admin/billing/${data}`);
  };

  if (!o) return <div className="flex justify-center py-20"><Spinner /></div>;
  const p = o.patients;
  const locked = !!o.invoice_id;
  const consTotal = (o.ot_consumables || []).reduce((s: number, c: any) => s + c.quantity * Number(c.unit_price), 0);
  const T = (k: string, label: string, rows = 3, placeholder = '') => (
    <label className="block"><span className="label">{label}</span><textarea className="input" rows={rows} placeholder={placeholder} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/admin/ot" className="no-print text-sm font-semibold text-brand-700">← Operation theatre</Link>

      <div className="card no-print p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <div className="flex items-center gap-2"><h1 className="text-xl font-bold">{o.procedure_name}</h1><StatusBadge status={o.status} /></div>
            <p className="text-sm text-ink-soft">{fullName(p)} · {p.mrn} · {age(p.dob)} · Blood {p.blood_group || '-'}</p>
            <p className="text-sm text-ink-soft">{o.theatre} · {fmtDateTime(o.scheduled_at)} · Surgeon {o.doctors?.full_name || '-'}</p>
            {o.actual_start && <p className="text-sm">Started {fmtDateTime(o.actual_start)}{o.actual_end ? ` · Ended ${fmtDateTime(o.actual_end)} (${Math.round((new Date(o.actual_end).getTime() - new Date(o.actual_start).getTime()) / 60000)} min)` : ''}</p>}
            {p.allergies && <p className="mt-1 text-sm font-semibold text-rose-600">Allergies: {p.allergies}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {o.status === 'scheduled' && <button className="btn-primary btn-sm" onClick={() => save({ status: 'in_progress', actual_start: new Date().toISOString() })}><Play size={14} /> Start surgery</button>}
            {o.status === 'in_progress' && <button className="btn-primary btn-sm" onClick={() => save({ status: 'completed', actual_end: new Date().toISOString() })}><CheckCircle2 size={14} /> Complete surgery</button>}
            <button className="btn-secondary btn-sm" onClick={() => window.print()}><Printer size={14} /> Print OT record</button>
            {o.invoices ? <Link href={`/admin/billing/${o.invoice_id}`} className="btn-secondary btn-sm"><Receipt size={14} /> Bill {o.invoices.invoice_no}</Link>
              : <button className="btn-secondary btn-sm" onClick={bill}><Receipt size={14} /> Create bill</button>}
          </div>
        </div>
      </div>

      {msg && <div className="no-print"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="print-area space-y-5">
        <div className="hidden print:block">
          <p className="text-xl font-extrabold text-brand-700">CarePlus Hospital · Operation Record</p>
          <p className="text-sm">{fullName(p)} · {p.mrn} · {o.procedure_name} · {o.theatre} · {fmtDateTime(o.actual_start || o.scheduled_at)} · Surgeon {o.doctors?.full_name}</p>
        </div>

        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-bold sm:col-span-2">Pre-operative</h2>
          <div className="sm:col-span-2">{T('pre_op_notes', 'Pre-op assessment & checklist', 3, 'Consent signed, NPO since, site marked, labs reviewed...')}</div>
        </div>

        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-bold sm:col-span-2">Anesthesia</h2>
          <label className="block"><span className="label">Type</span>
            <select className="input" value={f.anesthesia_type} onChange={(e) => setF({ ...f, anesthesia_type: e.target.value })}><option value="">Select...</option>{ANESTHESIA.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="block"><span className="label">Anesthetist</span>
            <select className="input" value={f.anesthetist_id} onChange={(e) => setF({ ...f, anesthetist_id: e.target.value })}><option value="">Select...</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
          <div className="sm:col-span-2">{T('anesthesia_notes', 'Anesthesia notes', 3, 'ASA class, airway, agents and doses, vitals, events...')}</div>
        </div>

        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="font-bold sm:col-span-2">Operation</h2>
          <div className="sm:col-span-2">{T('operative_notes', 'Operative notes', 6, 'Indication, findings, procedure steps, implants, specimens, closure...')}</div>
          <label className="block"><span className="label">Estimated blood loss (mL)</span><input className="input" inputMode="numeric" value={f.blood_loss_ml} onChange={(e) => setF({ ...f, blood_loss_ml: e.target.value })} /></label>
          <label className="block"><span className="label">Complications</span><input className="input" placeholder="None" value={f.complications} onChange={(e) => setF({ ...f, complications: e.target.value })} /></label>
          <div className="sm:col-span-2">{T('post_op_notes', 'Post-op orders & recovery', 3, 'Recovery room, pain management, diet, mobilization, follow-up...')}</div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold">Consumables used <span className="font-normal text-ink-muted">· {money(consTotal)}</span></h2>
            {!locked && <button className="no-print btn-primary btn-sm" onClick={() => setAddOpen(true)}><Plus size={14} /> Add</button>}
          </div>
          {(o.ot_consumables || []).length === 0 ? <Empty text="No consumables recorded. Items added here are taken out of stock." /> : (
            <ul className="divide-y divide-slate-100">
              {o.ot_consumables.map((c: any) => (
                <li key={c.id} className="flex justify-between px-5 py-2.5 text-sm"><span>{c.name} × {c.quantity}</span><span className="font-semibold">{money(c.quantity * Number(c.unit_price))}</span></li>
              ))}
            </ul>
          )}
        </div>

        <div className="card no-print grid gap-4 p-5 sm:grid-cols-3">
          <h2 className="font-bold sm:col-span-3">Billing</h2>
          <label className="block"><span className="label">Procedure fee ($)</span><input className="input" disabled={locked} inputMode="decimal" value={f.procedure_fee} onChange={(e) => setF({ ...f, procedure_fee: e.target.value })} /></label>
          <label className="block"><span className="label">CPT code</span><input className="input" disabled={locked} placeholder="44970" value={f.procedure_code} onChange={(e) => setF({ ...f, procedure_code: e.target.value })} /></label>
          <div className="self-end text-sm text-ink-soft">Bill total: <b className="text-ink">{money(Number(f.procedure_fee || 0) + consTotal)}</b>{locked && ' (billed)'}</div>
        </div>
      </div>

      <div className="no-print flex justify-end"><button className="btn-primary" disabled={busy} onClick={() => save()}>{busy && <Spinner />} Save OT record</button></div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add consumable">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[['item', 'Supply / inventory'], ['med', 'Medicine / fluid']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setAdd({ ...add, kind: k, id: '' })} className={`rounded-xl py-2 text-sm font-semibold ring-1 ${add.kind === k ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-200'}`}>{l}</button>
            ))}
          </div>
          <select className="input" value={add.id} onChange={(e) => setAdd({ ...add, id: e.target.value })}>
            <option value="">Select...</option>
            {add.kind === 'item'
              ? items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} left · {money(i.unit_price)})</option>)
              : meds.map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength} ({m.stock} left · {money(m.price)})</option>)}
          </select>
          <label className="block"><span className="label">Quantity</span><input type="number" min={1} className="input" value={add.qty} onChange={(e) => setAdd({ ...add, qty: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button><button className="btn-primary" disabled={!add.id || busy} onClick={addConsumable}>{busy && <Spinner />} Add & deduct stock</button></div>
        </div>
      </Modal>
    </div>
  );
}
