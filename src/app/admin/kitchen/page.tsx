'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X, Pause, Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, PageHeader, Alert, Spinner, Badge, Empty } from '@/components/ui';
import { useBranch } from '@/components/admin/branch';
import { cn, fullName, todayISO } from '@/lib/utils';

const DIETS = ['Regular', 'Diabetic', 'Low sodium', 'Cardiac', 'Renal', 'Soft', 'Pureed', 'Clear liquid', 'Full liquid', 'Vegetarian', 'Gluten free', 'NPO (nothing by mouth)'];
const MEALS = ['breakfast', 'lunch', 'dinner'] as const;

export default function Kitchen() {
  const supabase = createClient();
  const { branchId } = useBranch();
  const [rows, setRows] = useState<any[]>([]);
  const [meals, setMeals] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const today = todayISO();

  const load = useCallback(async () => {
    let q = supabase.from('admissions').select('id, patient_id, patients(first_name, last_name, mrn, allergies), beds(bed_no, wards(name)), diet_orders(*)').eq('status', 'admitted');
    if (branchId) q = q.eq('branch_id', branchId);
    const [{ data }, { data: m }] = await Promise.all([q, supabase.from('meal_service').select('*').eq('service_date', today)]);
    setRows((data || []).map((a: any) => ({ ...a, diet: (a.diet_orders || []).find((d: any) => d.status === 'active') }))
      .sort((a: any, b: any) => (a.beds?.wards?.name || '').localeCompare(b.beds?.wards?.name || '') || (a.beds?.bed_no || '').localeCompare(b.beds?.bed_no || '')));
    setMeals(m || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);
  useEffect(() => { load(); }, [load]);

  const mark = async (a: any, meal: string, status: string) => {
    const existing = meals.find((m) => m.admission_id === a.id && m.meal === meal);
    const { data: { user } } = await supabase.auth.getUser();
    const res = existing
      ? await supabase.from('meal_service').update({ status, served_by: user?.id }).eq('id', existing.id)
      : await supabase.from('meal_service').insert({ admission_id: a.id, diet_order_id: a.diet?.id || null, meal, status, served_by: user?.id });
    if (res.error) return alert(res.error.message);
    load();
  };

  const openDiet = (a: any) => { setEdit(a); setErr(''); setF({ diet_type: a.diet?.diet_type || 'Regular', texture: a.diet?.texture || '', fluid_limit_ml: a.diet?.fluid_limit_ml || '', food_allergies: a.diet?.food_allergies || a.patients?.allergies || '', instructions: a.diet?.instructions || '' }); };
  const saveDiet = async () => {
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('diet_orders').insert({ admission_id: edit.id, ...f, fluid_limit_ml: f.fluid_limit_ml ? Number(f.fluid_limit_ml) : null, ordered_by: user?.id });
    setBusy(false);
    if (error) return setErr(error.message);
    setEdit(null); load();
  };

  const counts = rows.reduce((acc: Record<string, number>, r) => { const k = r.diet?.diet_type || 'No diet order'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  return (
    <div>
      <PageHeader title="Diet & Kitchen" subtitle="Diet orders for admitted patients and today's meal service."
        actions={<button className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print meal list</button>} />
      <div className="no-print mb-5 flex flex-wrap gap-2">
        {(Object.entries(counts) as [string, number][]).map(([k, v]) => <span key={k} className="rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200"><b>{v}</b> {k}</span>)}
      </div>
      <div className="print-area card overflow-x-auto">
        <p className="hidden p-4 text-lg font-bold print:block">Meal list · {new Date().toLocaleDateString()}</p>
        {rows.length === 0 ? <Empty text="No admitted patients." /> : (
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/60"><tr><th className="th">Bed</th><th className="th">Patient</th><th className="th">Diet</th>{MEALS.map((m) => <th key={m} className="th no-print text-center capitalize">{m}</th>)}<th className="th no-print" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => {
                const npo = a.diet?.diet_type?.startsWith('NPO');
                return (
                  <tr key={a.id}>
                    <td className="td"><p className="font-semibold">{a.beds?.bed_no}</p><p className="text-xs text-ink-muted">{a.beds?.wards?.name}</p></td>
                    <td className="td"><Link href={`/admin/ipd/${a.id}`} className="font-semibold hover:text-brand-700">{fullName(a.patients)}</Link><p className="text-xs text-ink-muted">{a.patients?.mrn}</p></td>
                    <td className="td whitespace-normal">
                      {a.diet ? <><Badge tone={npo ? 'red' : 'blue'}>{a.diet.diet_type}</Badge>{a.diet.texture && <span className="ml-1 text-xs">{a.diet.texture}</span>}</> : <span className="text-xs text-ink-muted">No order</span>}
                      {(a.diet?.food_allergies || a.patients?.allergies) && <p className="mt-1 text-xs font-semibold text-rose-600">Allergy: {a.diet?.food_allergies || a.patients?.allergies}</p>}
                      {a.diet?.fluid_limit_ml && <p className="text-xs">Fluids max {a.diet.fluid_limit_ml} mL/day</p>}
                      {a.diet?.instructions && <p className="text-xs text-ink-soft">{a.diet.instructions}</p>}
                    </td>
                    {MEALS.map((m) => {
                      const rec = meals.find((x) => x.admission_id === a.id && x.meal === m);
                      return (
                        <td key={m} className="td no-print text-center">
                          {npo ? <span className="text-xs text-ink-muted">NPO</span> : rec ? (
                            <button onClick={() => mark(a, m, rec.status === 'served' ? 'refused' : rec.status === 'refused' ? 'held' : 'served')} title="Tap to change">
                              <Badge tone={rec.status === 'served' ? 'green' : rec.status === 'refused' ? 'red' : 'amber'}>{rec.status}</Badge>
                            </button>
                          ) : (
                            <div className="inline-flex gap-1">
                              <button className="rounded-lg bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100" title="Served" onClick={() => mark(a, m, 'served')}><Check size={14} /></button>
                              <button className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100" title="Refused" onClick={() => mark(a, m, 'refused')}><X size={14} /></button>
                              <button className="rounded-lg bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100" title="Held" onClick={() => mark(a, m, 'held')}><Pause size={14} /></button>
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="td no-print text-right"><button className="btn-secondary btn-sm" onClick={() => openDiet(a)}>{a.diet ? 'Change diet' : 'Set diet'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Diet order: ${fullName(edit?.patients)}`}>
        <div className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <div className="grid grid-cols-2 gap-1.5">
            {DIETS.map((d) => <button key={d} type="button" onClick={() => setF({ ...f, diet_type: d })} className={cn('rounded-lg px-2 py-2 text-xs font-semibold ring-1', f.diet_type === d ? 'bg-brand-600 text-white ring-brand-600' : 'ring-slate-200')}>{d}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Texture</span><input className="input" placeholder="Minced, chopped..." value={f.texture} onChange={(e) => setF({ ...f, texture: e.target.value })} /></label>
            <label className="block"><span className="label">Fluid limit (mL/day)</span><input className="input" inputMode="numeric" value={f.fluid_limit_ml} onChange={(e) => setF({ ...f, fluid_limit_ml: e.target.value })} /></label>
          </div>
          <label className="block"><span className="label">Food allergies</span><input className="input" value={f.food_allergies} onChange={(e) => setF({ ...f, food_allergies: e.target.value })} /></label>
          <label className="block"><span className="label">Instructions</span><textarea className="input" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={saveDiet}>{busy && <Spinner />} Save diet order</button></div>
        </div>
      </Modal>
    </div>
  );
}
