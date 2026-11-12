'use client';
import { useState } from 'react';
import ResourceManager from '@/components/admin/ResourceManager';
import { PageHeader, Tabs, Badge } from '@/components/ui';
import { deptOption } from '@/lib/fields';
import { cn, fmtDateTime } from '@/lib/utils';

export default function Inventory() {
  const [tab, setTab] = useState('items');
  const [reload, setReload] = useState(0);
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Surgical supplies, consumables, equipment and linen." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'items', label: 'Items' }, { id: 'moves', label: 'Stock in / out' }]} />
      {tab === 'items' && (
        <ResourceManager embedded table="inventory_items" branchScoped title="Items" reloadKey={reload} orderBy={{ column: 'name', ascending: true }}
          searchColumns={['name', 'category', 'location']}
          columns={[
            { key: 'name', label: 'Item', render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'category', label: 'Category', render: (r) => <Badge>{r.category}</Badge> },
            { key: 'quantity', label: 'Qty', render: (r) => <span className={cn('font-semibold', r.quantity <= r.reorder_level && 'text-rose-600')}>{r.quantity} {r.unit}</span> },
            { key: 'reorder_level', label: 'Reorder at', hideOnMobile: true },
            { key: 'location', label: 'Location', hideOnMobile: true },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'category', label: 'Category', type: 'select', options: ['consumable', 'surgical', 'equipment', 'linen'].map((v) => ({ value: v, label: v })) },
            { name: 'unit', label: 'Unit (pcs, box)' }, { name: 'quantity', label: 'Opening quantity', type: 'number' },
            { name: 'reorder_level', label: 'Reorder level', type: 'number' }, { name: 'location', label: 'Location' },
            { name: 'unit_price', label: 'Charge per unit ($, for OT billing)', type: 'number' },
          ]}
          defaults={{ unit: 'pcs', quantity: 0, reorder_level: 10 }}
        />
      )}
      {tab === 'moves' && (
        <ResourceManager embedded table="inventory_transactions" branchVia="inventory_items" title="Stock movements" select="*, inventory_items(name, unit), departments(name)" canEdit={false} canDelete={false}
          reloadKey={reload}
          columns={[
            { key: 'created_at', label: 'Date', render: (r) => fmtDateTime(r.created_at) },
            { key: 'item', label: 'Item', render: (r) => <span className="font-semibold">{r.inventory_items?.name}</span> },
            { key: 'txn_type', label: 'Type', render: (r) => <Badge tone={r.txn_type === 'in' ? 'green' : 'amber'}>{r.txn_type === 'in' ? 'Stock in' : 'Issued'}</Badge> },
            { key: 'quantity', label: 'Qty', render: (r) => `${r.quantity} ${r.inventory_items?.unit || ''}` },
            { key: 'dept', label: 'Department', render: (r) => r.departments?.name || '-', hideOnMobile: true },
            { key: 'note', label: 'Note', hideOnMobile: true },
          ]}
          fields={[
            { name: 'item_id', label: 'Item', type: 'select', required: true, optionsFrom: { table: 'inventory_items', select: 'id, name, quantity, unit', label: (r: any) => `${r.name} (${r.quantity} ${r.unit})`, order: 'name' } },
            { name: 'txn_type', label: 'Type', type: 'select', required: true, options: [{ value: 'in', label: 'Stock in (received)' }, { value: 'out', label: 'Issue to department' }] },
            { name: 'quantity', label: 'Quantity', type: 'number', required: true },
            { name: 'department_id', label: 'Department', type: 'select', optionsFrom: deptOption },
            { name: 'note', label: 'Note', type: 'textarea' },
          ]}
          defaults={{ txn_type: 'out' }}
        />
      )}
    </div>
  );
}
