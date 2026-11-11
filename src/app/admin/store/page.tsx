'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { PageHeader, Tabs, StatusBadge, Modal } from '@/components/ui';
import { fmtDateTime, money } from '@/lib/utils';

const STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];

export default function StoreAdmin() {
  const [tab, setTab] = useState('orders');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<any>(null);

  return (
    <div>
      <PageHeader title="Online Store" subtitle="Website orders and the product catalog." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'orders', label: 'Orders' }, { id: 'products', label: 'Products' }]} />

      {tab === 'orders' && (
        <>
          <select className="input mb-4 sm:max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
          </select>
          <ResourceManager embedded table="orders" title="Orders" select="*, order_items(*)" filters={{ status }} canCreate={false} canEdit={false} canDelete={false}
            searchColumns={['order_no', 'customer_name', 'email']}
            onRowClick={setView}
            columns={[
              { key: 'order_no', label: 'Order', render: (r) => <span className="font-semibold">{r.order_no}</span> },
              { key: 'created_at', label: 'Date', render: (r) => fmtDateTime(r.created_at), hideOnMobile: true },
              { key: 'customer_name', label: 'Customer' },
              { key: 'items', label: 'Items', render: (r) => r.order_items.reduce((s: number, i: any) => s + i.quantity, 0), hideOnMobile: true },
              { key: 'total', label: 'Total', render: (r) => <span className="font-bold">{money(r.total)}</span> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
            rowActions={(r, reload) => (
              <select className="input w-auto py-1 text-xs" value={r.status} onClick={(e) => e.stopPropagation()}
                onChange={async (e) => {
                  const s = e.target.value;
                  const sb = createClient();
                  if (s === 'paid' && r.status === 'pending') {
                    // reduce stock the same way online payments do
                    for (const i of r.order_items) {
                      if (!i.product_id) continue;
                      const { data: p } = await sb.from('products').select('stock').eq('id', i.product_id).single();
                      if (p) await sb.from('products').update({ stock: Math.max(0, p.stock - i.quantity) }).eq('id', i.product_id);
                    }
                  }
                  await sb.from('orders').update({ status: s }).eq('id', r.id);
                  reload();
                }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          />
        </>
      )}

      {tab === 'products' && (
        <ResourceManager embedded table="products" title="Products" orderBy={{ column: 'name', ascending: true }}
          searchColumns={['name', 'category', 'slug']}
          columns={[
            { key: 'name', label: 'Product', render: (r) => <div className="flex items-center gap-3">{r.image_url && <img src={r.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />}<span className="font-semibold">{r.name}</span></div> },
            { key: 'category', label: 'Category', hideOnMobile: true },
            { key: 'price', label: 'Price', render: (r) => money(r.price) },
            { key: 'stock', label: 'Stock', render: (r) => <span className={r.stock < 10 ? 'font-semibold text-rose-600' : ''}>{r.stock}</span> },
            { key: 'active', label: 'Visible', render: (r) => (r.active ? 'Yes' : 'No'), hideOnMobile: true },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true }, { name: 'slug', label: 'URL slug (e.g. bp-monitor)', required: true },
            { name: 'category', label: 'Category', type: 'select', options: ['Devices', 'Supplements', 'First Aid', 'Protection', 'Health Packages', 'Personal Care', 'Medicines'].map((v) => ({ value: v, label: v })) },
            { name: 'price', label: 'Price ($)', type: 'number', required: true }, { name: 'stock', label: 'Stock', type: 'number' },
            { name: 'image_url', label: 'Image URL', full: true }, { name: 'description', label: 'Description', type: 'textarea' },
            { name: 'active', label: 'Show on website', type: 'checkbox' },
          ]}
          defaults={{ active: true, stock: 0 }}
        />
      )}

      <Modal open={!!view} onClose={() => setView(null)} title={`Order ${view?.order_no || ''}`}>
        {view && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between"><StatusBadge status={view.status} /><span className="text-ink-soft">{fmtDateTime(view.created_at)}</span></div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="font-semibold">{view.customer_name}</p>
              <p className="text-ink-soft">{view.email} · {view.phone}</p>
              <p className="mt-1">{view.shipping_address}</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {view.order_items.map((i: any) => <li key={i.id} className="flex justify-between py-2"><span>{i.name} × {i.quantity}</span><span>{money(i.line_total)}</span></li>)}
            </ul>
            <div className="space-y-1 border-t border-slate-100 pt-3">
              <div className="flex justify-between"><span>Subtotal</span><span>{money(view.subtotal)}</span></div>
              <div className="flex justify-between"><span>Shipping</span><span>{money(view.shipping)}</span></div>
              <div className="flex justify-between"><span>Tax</span><span>{money(view.tax)}</span></div>
              <div className="flex justify-between font-bold"><span>Total</span><span>{money(view.total)}</span></div>
              <p className="pt-1 text-xs text-ink-muted">Payment: {view.payment_method.replace(/_/g, ' ')}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
