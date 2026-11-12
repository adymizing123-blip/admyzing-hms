'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, PageHeader, StatusBadge, Tabs, Empty, Alert, Spinner } from '@/components/ui';
import PatientPicker, { type PickedPatient } from '@/components/admin/PatientPicker';
import ResourceManager from '@/components/admin/ResourceManager';
import { useBranch } from '@/components/admin/branch';
import { cn, fmtDateTime, fullName, money } from '@/lib/utils';

function Lab() {
  const supabase = createClient();
  const { branchId } = useBranch();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState('pending');
  const [orders, setOrders] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [open, setOpen] = useState(!!params.get('new'));
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    let q = supabase.from('lab_orders').select('*, patients(first_name,last_name,mrn), doctors(full_name), lab_order_items(id, lab_tests(name))').order('ordered_at', { ascending: false }).limit(100);
    if (branchId) q = q.eq('branch_id', branchId);
    q = tab === 'pending' ? q.in('status', ['ordered', 'collected', 'processing']) : q.in('status', ['completed', 'cancelled']);
    const { data } = await q;
    setOrders(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, branchId]);

  useEffect(() => { if (tab === 'pending' || tab === 'done') load(); }, [load, tab]);
  useEffect(() => {
    supabase.from('lab_tests').select('*').eq('active', true).order('name').then(({ data }) => setTests(data || []));
    supabase.from('doctors').select('id, full_name').match(branchId ? { branch_id: branchId } : {}).order('full_name').then(({ data }) => setDoctors(data || []));
    const pid = params.get('new');
    if (pid) supabase.from('patients').select('id, first_name, last_name, mrn, phone').eq('id', pid).single().then(({ data }) => data && setPatient(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient || sel.length === 0) return setErr('Choose a patient and at least one test');
    setBusy(true);
    const { data: o, error } = await supabase.from('lab_orders').insert({ patient_id: patient.id, doctor_id: doctorId || null }).select().single();
    if (error) { setBusy(false); return setErr(error.message); }
    await supabase.from('lab_order_items').insert(sel.map((t) => ({ lab_order_id: o.id, lab_test_id: t, price: tests.find((x) => x.id === t)?.price || 0 })));
    setBusy(false);
    router.push(`/admin/lab/${o.id}`);
  };

  const total = sel.reduce((s, id) => s + Number(tests.find((t) => t.id === id)?.price || 0), 0);

  return (
    <div>
      <PageHeader title="Laboratory" subtitle="Lab orders, sample tracking and results." actions={<button className="btn-primary" onClick={() => { setOpen(true); setErr(''); }}><Plus size={16} /> New lab order</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'pending', label: 'Pending' }, { id: 'done', label: 'Completed' }, { id: 'tests', label: 'Test catalog' }, { id: 'log', label: 'Interface log' }]} />

      {tab === 'log' ? (
        <ResourceManager embedded table="lab_interface_log" title="Analyzer / HL7 messages" select="*, lab_orders(order_no)" canCreate={false} canEdit={false} canDelete={false}
          columns={[
            { key: 'created_at', label: 'Received', render: (r) => fmtDateTime(r.created_at) },
            { key: 'source', label: 'Source' },
            { key: 'order', label: 'Order', render: (r) => r.lab_orders?.order_no || '-' },
            { key: 'status', label: 'Result', render: (r) => <StatusBadge status={r.status === 'applied' ? 'completed' : r.status === 'partial' ? 'partial' : 'denied'} /> },
            { key: 'details', label: 'Details', className: 'whitespace-normal max-w-md text-xs' },
          ]}
        />
      ) : tab === 'tests' ? (
        <ResourceManager embedded table="lab_tests" title="Lab tests" orderBy={{ column: 'name', ascending: true }}
          columns={[
            { key: 'name', label: 'Test', render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'code', label: 'Code' }, { key: 'category', label: 'Category', hideOnMobile: true },
            { key: 'normal_range', label: 'Normal range', hideOnMobile: true }, { key: 'price', label: 'Price', render: (r) => money(r.price) },
          ]}
          searchColumns={['name', 'code', 'category']}
          fields={[
            { name: 'name', label: 'Name', required: true }, { name: 'code', label: 'Code' }, { name: 'category', label: 'Category' },
            { name: 'sample_type', label: 'Sample type' }, { name: 'normal_range', label: 'Normal range' }, { name: 'unit', label: 'Unit' },
            { name: 'price', label: 'Price ($)', type: 'number', required: true }, { name: 'turnaround_hours', label: 'Turnaround (hours)', type: 'number' },
            { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          defaults={{ active: true }}
        />
      ) : (
        <div className="card divide-y divide-slate-100">
          {orders.length === 0 && <Empty />}
          {orders.map((o) => (
            <Link key={o.id} href={`/admin/lab/${o.id}`} className="flex flex-col gap-2 px-5 py-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{o.order_no} · {fullName(o.patients)} <span className="text-xs font-normal text-ink-muted">{o.patients?.mrn}</span></p>
                <p className="truncate text-xs text-ink-soft">{o.lab_order_items.map((i: any) => i.lab_tests?.name).join(', ')}</p>
                <p className="text-xs text-ink-muted">{fmtDateTime(o.ordered_at)} · {o.doctors?.full_name || 'Walk-in'}</p>
              </div>
              <StatusBadge status={o.status} />
            </Link>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New lab order" wide>
        <form onSubmit={create} className="space-y-4">
          {err && <Alert>{err}</Alert>}
          <div><span className="label">Patient</span><PatientPicker value={patient} onChange={setPatient} /></div>
          <label className="block"><span className="label">Referring doctor</span>
            <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}><option value="">Walk-in / self</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
          <div>
            <span className="label">Tests</span>
            <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {tests.map((t) => {
                const on = sel.includes(t.id);
                return (
                  <button type="button" key={t.id} onClick={() => setSel(on ? sel.filter((x) => x !== t.id) : [...sel, t.id])}
                    className={cn('flex justify-between rounded-xl px-3 py-2 text-left text-sm ring-1', on ? 'bg-brand-50 ring-brand-400' : 'ring-slate-200')}>
                    <span>{t.name}</span><span className="font-semibold">{money(t.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm">Total: <b>{money(total)}</b></span>
            <button className="btn-primary" disabled={busy}>{busy && <Spinner />} Create order</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function Page() { return <Suspense><Lab /></Suspense>; }
