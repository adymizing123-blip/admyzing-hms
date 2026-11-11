'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2, PackageCheck, Printer } from 'lucide-react';
import { ShiftReport } from '@/components/pos/ShiftModals';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { Modal, PageHeader, Tabs, Badge, StatusBadge, Alert, Spinner } from '@/components/ui';
import { cn, fmtDate, fmtDateTime, money } from '@/lib/utils';

const medOption = { table: 'medicines', select: 'id, name, strength', label: (r: any) => `${r.name} ${r.strength || ''}`, order: 'name' };
const supplierOption = { table: 'suppliers', select: 'id, name', label: (r: any) => r.name, order: 'name' };

export default function Pharmacy() {
  const [tab, setTab] = useState('medicines');
  const [poOpen, setPoOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [shiftView, setShiftView] = useState<any>(null);
  const [shiftReport, setShiftReport] = useState<any>(null);

  useEffect(() => {
    setShiftReport(null);
    if (!shiftView) return;
    if (shiftView.summary) return setShiftReport(shiftView.summary);
    createClient().rpc('pos_shift_summary', { p_shift: shiftView.id }).then(({ data }) => setShiftReport(data));
  }, [shiftView]);

  return (
    <div>
      <PageHeader title="Medicines & Stock" subtitle="Catalog, batches with expiry, suppliers and purchase orders." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'medicines', label: 'Medicines' }, { id: 'batches', label: 'Stock batches' }, { id: 'expiring', label: 'Expiring soon' },
        { id: 'po', label: 'Purchase orders' }, { id: 'suppliers', label: 'Suppliers' }, { id: 'sales', label: 'Sales history' },
        { id: 'returns', label: 'Returns' }, { id: 'shifts', label: 'Shifts' },
      ]} />

      {tab === 'medicines' && (
        <ResourceManager embedded table="medicine_stock" writeTable="medicines" title="Medicines" orderBy={{ column: 'name', ascending: true }}
          columns={[
            { key: 'name', label: 'Medicine', render: (r) => <div><p className="font-semibold">{r.name} {r.strength}</p><p className="text-xs text-ink-muted">{r.generic_name} · {r.form}</p></div> },
            { key: 'category', label: 'Category', hideOnMobile: true },
            { key: 'sku', label: 'SKU', hideOnMobile: true },
            { key: 'price', label: 'Price', render: (r) => money(r.price) },
            { key: 'stock', label: 'Stock', render: (r) => <span className={cn('font-semibold', r.stock <= r.reorder_level && 'text-rose-600')}>{r.stock}</span> },
            { key: 'next_expiry', label: 'Next expiry', render: (r) => fmtDate(r.next_expiry), hideOnMobile: true },
            { key: 'rx', label: 'Type', render: (r) => r.requires_prescription ? <Badge tone="violet">Rx</Badge> : <Badge>OTC</Badge>, hideOnMobile: true },
          ]}
          searchColumns={['name', 'generic_name', 'sku', 'barcode', 'category']}
          fields={[
            { name: 'name', label: 'Brand name', required: true }, { name: 'generic_name', label: 'Generic name' },
            { name: 'category', label: 'Category' }, { name: 'form', label: 'Form', type: 'select', options: ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Inhaler', 'Cream', 'Drops', 'IV Bag', 'Softgel'].map((v) => ({ value: v, label: v })) },
            { name: 'strength', label: 'Strength' }, { name: 'sku', label: 'SKU' }, { name: 'barcode', label: 'Barcode (UPC)' },
            { name: 'price', label: 'Selling price ($)', type: 'number', required: true }, { name: 'cost', label: 'Cost ($)', type: 'number' },
            { name: 'reorder_level', label: 'Reorder level', type: 'number' },
            { name: 'requires_prescription', label: 'Prescription required', type: 'checkbox' }, { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          defaults={{ active: true, reorder_level: 20 }}
        />
      )}

      {tab === 'batches' && (
        <ResourceManager embedded table="medicine_batches" branchScoped title="Stock batches" select="*, medicines(name, strength), suppliers(name)" orderBy={{ column: 'expiry_date', ascending: true }}
          columns={[
            { key: 'med', label: 'Medicine', render: (r) => <span className="font-semibold">{r.medicines?.name} {r.medicines?.strength}</span> },
            { key: 'batch_no', label: 'Batch' },
            { key: 'expiry_date', label: 'Expiry', render: (r) => <span className={new Date(r.expiry_date) < new Date(Date.now() + 60 * 864e5) ? 'font-semibold text-amber-700' : ''}>{fmtDate(r.expiry_date)}</span> },
            { key: 'quantity', label: 'Qty' },
            { key: 'supplier', label: 'Supplier', render: (r) => r.suppliers?.name || '-', hideOnMobile: true },
            { key: 'received_at', label: 'Received', render: (r) => fmtDate(r.received_at), hideOnMobile: true },
          ]}
          searchColumns={['batch_no']}
          fields={[
            { name: 'medicine_id', label: 'Medicine', type: 'select', optionsFrom: medOption, required: true },
            { name: 'batch_no', label: 'Batch number', required: true }, { name: 'expiry_date', label: 'Expiry date', type: 'date', required: true },
            { name: 'quantity', label: 'Quantity', type: 'number', required: true }, { name: 'cost', label: 'Unit cost ($)', type: 'number' },
            { name: 'supplier_id', label: 'Supplier', type: 'select', optionsFrom: supplierOption },
          ]}
        />
      )}

      {tab === 'expiring' && (
        <ResourceManager embedded table="expiring_batches" title="Batches expiring within 60 days" orderBy={{ column: 'expiry_date', ascending: true }} canCreate={false} canEdit={false} canDelete={false}
          columns={[
            { key: 'medicine_name', label: 'Medicine', render: (r) => <span className="font-semibold">{r.medicine_name}</span> },
            { key: 'batch_no', label: 'Batch' },
            { key: 'expiry_date', label: 'Expiry', render: (r) => <span className={new Date(r.expiry_date) < new Date() ? 'font-bold text-rose-600' : 'font-semibold text-amber-700'}>{fmtDate(r.expiry_date)}</span> },
            { key: 'quantity', label: 'Qty left' },
          ]}
        />
      )}

      {tab === 'suppliers' && (
        <ResourceManager embedded table="suppliers" title="Suppliers" orderBy={{ column: 'name', ascending: true }}
          columns={[{ key: 'name', label: 'Supplier', render: (r) => <span className="font-semibold">{r.name}</span> }, { key: 'contact_person', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', hideOnMobile: true }]}
          searchColumns={['name', 'contact_person', 'email']}
          fields={[{ name: 'name', label: 'Company', required: true }, { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'address', label: 'Address', type: 'textarea' }]}
        />
      )}

      {tab === 'po' && (
        <ResourceManager embedded table="purchase_orders" title="Purchase orders" reloadKey={reload}
          select="*, suppliers(name), purchase_order_items(quantity, unit_cost, medicines(name))"
          headerActions={null}
          columns={[
            { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
            { key: 'supplier', label: 'Supplier', render: (r) => <span className="font-semibold">{r.suppliers?.name}</span> },
            { key: 'items', label: 'Items', render: (r) => <span className="text-xs">{r.purchase_order_items.map((i: any) => `${i.medicines?.name} × ${i.quantity}`).join(', ')}</span> },
            { key: 'total', label: 'Total', render: (r) => money(r.total) },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          canCreate={false} canEdit={false}
          rowActions={(r, reloadRows) => r.status !== 'received' && r.status !== 'cancelled' ? (
            <>
              {r.status === 'draft' && <button className="btn-secondary btn-sm" onClick={async () => { await createClient().from('purchase_orders').update({ status: 'ordered' }).eq('id', r.id); reloadRows(); }}>Mark ordered</button>}
              <button className="btn-primary btn-sm" onClick={async () => {
                const exp = prompt('Expiry date for received stock (YYYY-MM-DD)', new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10));
                if (!exp) return;
                const { error } = await createClient().rpc('receive_purchase_order', { p_po: r.id, p_expiry: exp });
                if (error) alert(error.message); else reloadRows();
              }}><PackageCheck size={14} /> Receive</button>
            </>
          ) : null}
        />
      )}
      {tab === 'po' && <button className="btn-primary mt-4" onClick={() => setPoOpen(true)}><Plus size={16} /> New purchase order</button>}

      {tab === 'sales' && (
        <ResourceManager embedded table="pharmacy_sales" branchScoped title="Sales" select="*, patients(first_name, last_name), pharmacy_sale_items(quantity, medicines(name)), pharmacy_sale_payments(method, amount)" canCreate={false} canEdit={false} canDelete={false}
          searchColumns={['sale_no']}
          columns={[
            { key: 'sale_no', label: 'Receipt', render: (r) => <span className="font-semibold">{r.sale_no}</span> },
            { key: 'created_at', label: 'Date', render: (r) => fmtDateTime(r.created_at) },
            { key: 'items', label: 'Items', render: (r) => <span className="text-xs">{r.pharmacy_sale_items.map((i: any) => `${i.medicines?.name} × ${i.quantity}`).join(', ')}</span>, hideOnMobile: true },
            { key: 'patient', label: 'Patient', render: (r) => r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : 'Walk-in', hideOnMobile: true },
            { key: 'paid', label: 'Paid by', render: (r) => <span className="text-xs capitalize">{(r.pharmacy_sale_payments || []).map((p: any) => `${p.method === 'bill' ? 'patient bill' : p.method} ${money(p.amount)}`).join(' + ') || r.payment_method}</span> },
            { key: 'total', label: 'Total', render: (r) => <span className="font-bold">{money(r.total)}</span> },
            { key: 'status', label: 'Status', render: (r) => r.status === 'completed' ? <Badge tone="green">Completed</Badge> : <Badge tone={r.status === 'refunded' ? 'gray' : 'amber'}>{r.status === 'refunded' ? 'Refunded' : `Refunded ${money(r.refunded_total)}`}</Badge> },
          ]}
        />
      )}

      {tab === 'returns' && (
        <ResourceManager embedded table="pharmacy_returns" title="Returns" select="*, pharmacy_sales(sale_no), pharmacy_return_items(quantity, restocked, pharmacy_sale_items(medicines(name))), profiles(full_name)" canCreate={false} canEdit={false} canDelete={false}
          searchColumns={['return_no', 'reason']}
          columns={[
            { key: 'return_no', label: 'Return', render: (r) => <span className="font-semibold">{r.return_no}</span> },
            { key: 'created_at', label: 'Date', render: (r) => fmtDateTime(r.created_at) },
            { key: 'sale', label: 'Receipt', render: (r) => r.pharmacy_sales?.sale_no },
            { key: 'items', label: 'Items', render: (r) => <span className="text-xs">{r.pharmacy_return_items.map((i: any) => `${i.pharmacy_sale_items?.medicines?.name} × ${i.quantity}${i.restocked ? '' : ' (not restocked)'}`).join(', ')}</span>, hideOnMobile: true },
            { key: 'refund_method', label: 'Refunded to', render: (r) => <span className="capitalize">{r.refund_method === 'bill' ? 'patient bill' : r.refund_method}</span> },
            { key: 'reason', label: 'Reason', hideOnMobile: true, className: 'whitespace-normal max-w-xs' },
            { key: 'total', label: 'Amount', render: (r) => <span className="font-bold text-rose-600">-{money(r.total)}</span> },
          ]}
        />
      )}

      {tab === 'shifts' && (
        <ResourceManager embedded table="pos_shifts" branchScoped title="Shifts" select="*, profiles(full_name)" orderBy={{ column: 'opened_at', ascending: false }} canCreate={false} canEdit={false} canDelete={false}
          searchColumns={['shift_no']}
          onRowClick={setShiftView}
          columns={[
            { key: 'shift_no', label: 'Shift', render: (r) => <span className="font-semibold">{r.shift_no}</span> },
            { key: 'cashier', label: 'Cashier', render: (r) => r.profiles?.full_name || '-' },
            { key: 'opened_at', label: 'Opened', render: (r) => fmtDateTime(r.opened_at) },
            { key: 'closed_at', label: 'Closed', render: (r) => (r.closed_at ? fmtDateTime(r.closed_at) : '-'), hideOnMobile: true },
            { key: 'expected_cash', label: 'Expected', render: (r) => (r.expected_cash != null ? money(r.expected_cash) : '-'), hideOnMobile: true },
            { key: 'counted_cash', label: 'Counted', render: (r) => (r.counted_cash != null ? money(r.counted_cash) : '-'), hideOnMobile: true },
            { key: 'difference', label: 'Over / short', render: (r) => r.difference == null ? '-' : <span className={cn('font-semibold', Math.abs(r.difference) < 0.005 ? 'text-emerald-700' : 'text-rose-600')}>{r.difference > 0 ? '+' : ''}{money(r.difference)}</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'open' ? 'green' : 'gray'}>{r.status === 'open' ? 'Open' : 'Closed'}</Badge> },
          ]}
        />
      )}

      <Modal open={!!shiftView} onClose={() => setShiftView(null)} title={`Shift ${shiftView?.shift_no || ''}`}>
        {shiftReport ? (
          <div className="space-y-4">
            <ShiftReport s={shiftReport} counted={shiftView?.counted_cash ?? null} closed={shiftView?.status === 'closed'} />
            <div className="no-print flex justify-end"><button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print</button></div>
          </div>
        ) : <div className="flex justify-center py-10"><Spinner /></div>}
      </Modal>

      <NewPO open={poOpen} onClose={() => setPoOpen(false)} onSaved={() => setReload((x) => x + 1)} />
    </div>
  );
}

function NewPO({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [meds, setMeds] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState([{ medicine_id: '', quantity: '', unit_cost: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    supabase.from('suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data || []));
    supabase.from('medicine_stock').select('id, name, strength, cost, stock, reorder_level').order('stock').then(({ data }) => setMeds(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fillLow = () => setLines(meds.filter((m) => m.stock <= m.reorder_level).map((m) => ({ medicine_id: m.id, quantity: String(m.reorder_level * 3), unit_cost: String(m.cost) })));

  const save = async () => {
    const valid = lines.filter((l) => l.medicine_id && Number(l.quantity) > 0);
    if (!supplierId || !valid.length) return setErr('Choose a supplier and add at least one item');
    setBusy(true);
    const total = valid.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_cost || 0), 0);
    const { data: po, error } = await supabase.from('purchase_orders').insert({ supplier_id: supplierId, total }).select().single();
    if (error) { setBusy(false); return setErr(error.message); }
    await supabase.from('purchase_order_items').insert(valid.map((l) => ({ purchase_order_id: po.id, medicine_id: l.medicine_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost || 0) })));
    setBusy(false);
    setLines([{ medicine_id: '', quantity: '', unit_cost: '' }]);
    onSaved(); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New purchase order" wide>
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier...</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button type="button" className="btn-secondary whitespace-nowrap" onClick={fillLow}>Add all low-stock items</button>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <select className="input col-span-12 sm:col-span-6" value={l.medicine_id} onChange={(e) => { const n = [...lines]; n[i] = { ...l, medicine_id: e.target.value }; setLines(n); }}>
              <option value="">Medicine...</option>{meds.map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength} (stock {m.stock})</option>)}
            </select>
            <input className="input col-span-5 sm:col-span-2" placeholder="Qty" value={l.quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...l, quantity: e.target.value }; setLines(n); }} />
            <input className="input col-span-5 sm:col-span-3" placeholder="Unit cost" value={l.unit_cost} onChange={(e) => { const n = [...lines]; n[i] = { ...l, unit_cost: e.target.value }; setLines(n); }} />
            <button className="btn-ghost col-span-2 px-0 text-rose-600 sm:col-span-1" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={16} /></button>
          </div>
        ))}
        <button className="btn-secondary btn-sm" onClick={() => setLines([...lines, { medicine_id: '', quantity: '', unit_cost: '' }])}><Plus size={14} /> Add line</button>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />} Create PO</button></div>
      </div>
    </Modal>
  );
}
