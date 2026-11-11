'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Check, Pause, X, Pill } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, Alert, Spinner, Badge, Empty } from '@/components/ui';
import { cn, fmtDateTime, fmtTime, todayISO } from '@/lib/utils';

const ROUTES = ['oral', 'IV', 'IM', 'SC', 'topical', 'inhaled', 'sublingual', 'rectal'];
const FREQ: Record<string, string[]> = {
  'Once daily': ['09:00'], 'Twice daily': ['08:00', '20:00'], 'Three times daily': ['08:00', '14:00', '20:00'],
  'Four times daily': ['06:00', '12:00', '18:00', '23:00'], 'Every 8 hours': ['06:00', '14:00', '22:00'], 'At bedtime': ['21:00'], 'As needed (PRN)': [],
};
const statusTone: Record<string, any> = { given: 'green', held: 'amber', refused: 'red', missed: 'gray' };

/** Medication Administration Record for one admission: doctor orders + nurse dose charting. */
export default function MAR({ admissionId, active }: { admissionId: string; active: boolean }) {
  const supabase = createClient();
  const [orders, setOrders] = useState<any[]>([]);
  const [doses, setDoses] = useState<any[]>([]);
  const [meds, setMeds] = useState<any[]>([]);
  const [role, setRole] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [{ data: o }, { data: d }] = await Promise.all([
      supabase.from('medication_orders').select('*, profiles(full_name)').eq('admission_id', admissionId).order('created_at'),
      supabase.from('medication_administrations').select('*, profiles(full_name)').eq('admission_id', admissionId).order('recorded_at', { ascending: false }),
    ]);
    setOrders(o || []); setDoses(d || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId]);

  useEffect(() => {
    load();
    supabase.from('medicines').select('id, name, strength, form').eq('active', true).order('name').then(({ data }) => setMeds(data || []));
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      const { data } = await supabase.from('profiles').select('role').eq('id', user?.id).single();
      setRole(data?.role || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const canOrder = role === 'doctor' || role === 'admin';
  const canChart = ['doctor', 'nurse', 'admin'].includes(role);

  // today's scheduled doses
  const today = todayISO();
  const slots = useMemo(() => orders
    .filter((o) => o.status === 'active' && !o.prn && String(o.start_date).slice(0, 10) <= today && (!o.end_date || String(o.end_date).slice(0, 10) >= today))
    .flatMap((o) => (o.times || []).map((t: string) => {
      const [h, m] = t.split(':').map(Number);
      const at = new Date(`${today}T00:00:00`);
      at.setHours(h, m, 0, 0);
      const rec = doses.find((d) => d.order_id === o.id && d.scheduled_for && new Date(d.scheduled_for).getTime() === at.getTime());
      return { order: o, at, rec };
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime()), [orders, doses, today]);

  const prnOrders = orders.filter((o) => o.status === 'active' && o.prn);

  const chart = async (order: any, at: Date | null, status: string) => {
    let notes: string | null = null;
    if (status !== 'given') {
      notes = prompt(`Reason the dose was ${status}:`);
      if (!notes) return;
    }
    const { error } = await supabase.rpc('mar_record', { p_order: order.id, p_scheduled: at ? at.toISOString() : null, p_status: status, p_notes: notes });
    if (error) return alert(error.message);
    load();
  };

  const openNew = () => {
    setForm({ medicine_id: '', medicine_name: '', dose: '', units_per_dose: 1, route: 'oral', frequency: 'Twice daily', times: '08:00, 20:00', start_date: today, end_date: '', instructions: '' });
    setErr(''); setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const prn = form.frequency === 'As needed (PRN)';
    const med = meds.find((m) => m.id === form.medicine_id);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('medication_orders').insert({
      admission_id: admissionId, medicine_id: form.medicine_id || null,
      medicine_name: med ? `${med.name} ${med.strength || ''}`.trim() : form.medicine_name,
      dose: form.dose || null, units_per_dose: Number(form.units_per_dose) || 1, route: form.route, frequency: form.frequency, prn,
      times: prn ? [] : String(form.times).split(',').map((t) => t.trim()).filter(Boolean),
      start_date: form.start_date, end_date: form.end_date || null, instructions: form.instructions || null, ordered_by: user?.id,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false); load();
  };

  const stop = async (o: any) => {
    if (!confirm(`Stop ${o.medicine_name}?`)) return;
    const { error } = await supabase.from('medication_orders').update({ status: 'stopped' }).eq('id', o.id);
    if (error) return alert(error.message);
    load();
  };

  return (
    <div className="space-y-5">
      {/* Today's schedule */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold">Today&apos;s medication schedule</h2>
          <span className="text-xs text-ink-muted">{slots.filter((s) => s.rec).length} of {slots.length} charted</span>
        </div>
        {slots.length === 0 && prnOrders.length === 0 ? <Empty text="No scheduled doses today." /> : (
          <div className="space-y-2">
            {slots.map(({ order, at, rec }) => {
              const overdue = !rec && at.getTime() < Date.now() - 3600e3;
              return (
                <div key={order.id + at.toISOString()} className={cn('flex flex-col gap-2 rounded-xl p-3 ring-1 sm:flex-row sm:items-center', overdue ? 'bg-rose-50 ring-rose-200' : 'bg-white ring-slate-200')}>
                  <span className={cn('w-20 shrink-0 whitespace-nowrap text-sm font-bold', overdue && 'text-rose-600')}>{fmtTime(at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{order.medicine_name} {order.dose && <span className="font-normal text-ink-soft">· {order.dose}</span>}</p>
                    <p className="text-xs text-ink-muted">{order.route}{order.units_per_dose > 1 ? ` · ${order.units_per_dose} units` : ''}{order.instructions ? ` · ${order.instructions}` : ''}</p>
                  </div>
                  {rec ? (
                    <div className="text-right">
                      <Badge tone={statusTone[rec.status]}>{rec.status[0].toUpperCase() + rec.status.slice(1)}</Badge>
                      <p className="mt-0.5 text-[11px] text-ink-muted">{fmtTime(rec.recorded_at)} · {rec.profiles?.full_name || 'Staff'}{rec.notes ? ` · ${rec.notes}` : ''}</p>
                    </div>
                  ) : active && canChart ? (
                    <div className="flex gap-1.5">
                      <button className="btn-primary btn-sm" onClick={() => chart(order, at, 'given')}><Check size={13} /> Given</button>
                      <button className="btn-secondary btn-sm" onClick={() => chart(order, at, 'held')}><Pause size={13} /> Held</button>
                      <button className="btn-secondary btn-sm" onClick={() => chart(order, at, 'refused')}><X size={13} /> Refused</button>
                    </div>
                  ) : <Badge>Pending</Badge>}
                </div>
              );
            })}
            {prnOrders.map((o) => (
              <div key={o.id} className="flex flex-col gap-2 rounded-xl bg-violet-50/50 p-3 ring-1 ring-violet-200 sm:flex-row sm:items-center">
                <span className="w-16 shrink-0 text-xs font-bold text-violet-700">PRN</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{o.medicine_name} {o.dose && <span className="font-normal text-ink-soft">· {o.dose}</span>}</p>
                  <p className="text-xs text-ink-muted">As needed · {o.route}{o.instructions ? ` · ${o.instructions}` : ''} · given {doses.filter((d) => d.order_id === o.id && d.status === 'given' && new Date(d.recorded_at).toDateString() === new Date().toDateString()).length}× today</p>
                </div>
                {active && canChart && <button className="btn-primary btn-sm" onClick={() => chart(o, null, 'given')}><Pill size={13} /> Give dose</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Orders */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-bold">Medication orders</h2>
          {active && canOrder && <button className="btn-primary btn-sm" onClick={openNew}><Plus size={14} /> New order</button>}
        </div>
        {orders.length === 0 ? <Empty text="No medication orders." /> : (
          <ul className="divide-y divide-slate-100">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{o.medicine_name} <span className="font-normal text-ink-soft">{o.dose} · {o.route} · {o.frequency}</span></p>
                  <p className="text-xs text-ink-muted">{o.prn ? 'As needed' : (o.times || []).join(', ')} · from {String(o.start_date).slice(0, 10)}{o.end_date ? ` to ${String(o.end_date).slice(0, 10)}` : ''} · ordered by {o.profiles?.full_name || 'doctor'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={o.status === 'active' ? 'green' : 'gray'}>{o.status === 'active' ? 'Active' : 'Stopped'}</Badge>
                  {active && o.status === 'active' && canChart && <button className="btn-ghost btn-sm text-rose-600" onClick={() => stop(o)}>Stop</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* History */}
      {doses.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 font-bold">Administration history</div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {doses.map((d) => {
              const o = orders.find((x) => x.id === d.order_id);
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">{o?.medicine_name}</p><p className="text-xs text-ink-muted">{d.scheduled_for ? `Due ${fmtTime(d.scheduled_for)} · ` : 'PRN · '}{fmtDateTime(d.recorded_at)} · {d.profiles?.full_name || 'Staff'}{d.notes ? ` · ${d.notes}` : ''}</p></div>
                  <Badge tone={statusTone[d.status]}>{d.status}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New medication order" wide>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
          <label className="block sm:col-span-2"><span className="label">Medicine (from pharmacy)</span>
            <select className="input" value={form.medicine_id} onChange={(e) => setForm({ ...form, medicine_id: e.target.value })}>
              <option value="">Other (type below)</option>
              {meds.map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength} {m.form}</option>)}
            </select></label>
          {!form.medicine_id && <label className="block sm:col-span-2"><span className="label">Medicine name</span><input className="input" required value={form.medicine_name} onChange={(e) => setForm({ ...form, medicine_name: e.target.value })} /></label>}
          <label className="block"><span className="label">Dose</span><input className="input" placeholder="500 mg" value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} /></label>
          <label className="block"><span className="label">Units taken from stock per dose</span><input type="number" min={1} className="input" value={form.units_per_dose} onChange={(e) => setForm({ ...form, units_per_dose: e.target.value })} /></label>
          <label className="block"><span className="label">Route</span><select className="input" value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })}>{ROUTES.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="block"><span className="label">Frequency</span>
            <select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value, times: FREQ[e.target.value].join(', ') })}>
              {Object.keys(FREQ).map((f) => <option key={f}>{f}</option>)}
            </select></label>
          {form.frequency !== 'As needed (PRN)' && <label className="block sm:col-span-2"><span className="label">Dose times (24h, comma separated)</span><input className="input" value={form.times} onChange={(e) => setForm({ ...form, times: e.target.value })} /></label>}
          <label className="block"><span className="label">Start</span><input type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
          <label className="block"><span className="label">End (optional)</span><input type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="label">Instructions</span><input className="input" placeholder="After food, check BP before giving..." value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Save order</button></div>
        </form>
      </Modal>
    </div>
  );
}
