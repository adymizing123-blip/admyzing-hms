'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import ResourceManager from '@/components/admin/ResourceManager';
import { PageHeader, Tabs, StatusBadge } from '@/components/ui';
import { fmtDate, money } from '@/lib/utils';

export default function Billing() {
  const router = useRouter();
  const [tab, setTab] = useState('invoices');
  const [status, setStatus] = useState('');
  return (
    <div>
      <PageHeader title="Billing & Accounts" subtitle="Invoices, payments, insurance claims and expenses."
        actions={<Link href="/admin/billing/new" className="btn-primary"><Plus size={16} /> New invoice</Link>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'invoices', label: 'Invoices' }, { id: 'payments', label: 'Payments' }, { id: 'claims', label: 'Insurance claims' }, { id: 'expenses', label: 'Expenses' }]} />

      {tab === 'invoices' && (
        <>
          <select className="input mb-4 sm:max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>{['unpaid', 'partial', 'paid', 'draft', 'void'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <ResourceManager embedded table="invoices" branchScoped title="Invoices" select="*, patients(first_name, last_name, mrn)" filters={{ status }}
            canCreate={false} canEdit={false} canDelete={false} searchColumns={['invoice_no', 'notes']}
            onRowClick={(r) => router.push(`/admin/billing/${r.id}`)}
            columns={[
              { key: 'invoice_no', label: 'Invoice', render: (r) => <span className="font-semibold">{r.invoice_no}</span> },
              { key: 'patient', label: 'Patient', render: (r) => r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : '-' },
              { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at), hideOnMobile: true },
              { key: 'notes', label: 'For', hideOnMobile: true },
              { key: 'total', label: 'Total', render: (r) => <span className="font-bold">{money(r.total)}</span> },
              { key: 'due', label: 'Balance', render: (r) => money(Number(r.total) - Number(r.amount_paid)), hideOnMobile: true },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </>
      )}

      {tab === 'payments' && (
        <ResourceManager embedded table="payments" branchVia="invoices" title="Payments" select="*, invoices(invoice_no, patients(first_name, last_name))" canCreate={false} canEdit={false} canDelete={false}
          columns={[
            { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
            { key: 'invoice', label: 'Invoice', render: (r) => <Link href={`/admin/billing/${r.invoice_id}`} className="font-semibold text-brand-700">{r.invoices?.invoice_no}</Link> },
            { key: 'patient', label: 'Patient', render: (r) => r.invoices?.patients ? `${r.invoices.patients.first_name} ${r.invoices.patients.last_name}` : '-', hideOnMobile: true },
            { key: 'method', label: 'Method', render: (r) => <span className="capitalize">{r.method}</span> },
            { key: 'reference', label: 'Reference', hideOnMobile: true },
            { key: 'amount', label: 'Amount', render: (r) => <span className="font-bold">{money(r.amount)}</span> },
          ]}
        />
      )}

      {tab === 'claims' && (
        <ResourceManager embedded table="insurance_claims" branchVia="invoices" title="Claims" select="*, invoices(invoice_no)" searchColumns={['provider', 'claim_no', 'member_id']}
          onRowClick={(r) => router.push(`/admin/billing/claims/${r.id}`)}
          columns={[
            { key: 'created_at', label: 'Submitted', render: (r) => fmtDate(r.created_at) },
            { key: 'provider', label: 'Insurer', render: (r) => <span className="font-semibold">{r.provider}</span> },
            { key: 'invoice', label: 'Invoice', render: (r) => <Link href={`/admin/billing/${r.invoice_id}`} className="text-brand-700">{r.invoices?.invoice_no}</Link> },
            { key: 'claim_no', label: 'Claim #', hideOnMobile: true },
            { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
            { key: 'sub', label: 'Sent', render: (r) => <span className={`text-xs font-semibold ${r.submission_status === 'sent' ? 'text-emerald-700' : r.submission_status === 'failed' ? 'text-rose-600' : 'text-ink-muted'}`}>{r.submission_status === 'sent' ? 'Electronically' : r.submission_status === 'failed' ? 'Failed' : 'Not sent'}</span>, hideOnMobile: true },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          canCreate={false}
          fields={[
            { name: 'claim_no', label: 'Claim number' }, { name: 'amount', label: 'Amount ($)', type: 'number' },
            { name: 'status', label: 'Status', type: 'select', options: ['submitted', 'approved', 'denied', 'paid'].map((v) => ({ value: v, label: v })) },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
        />
      )}

      {tab === 'expenses' && (
        <ResourceManager embedded table="expenses" branchScoped title="Expenses" orderBy={{ column: 'spent_on', ascending: false }} searchColumns={['category', 'description']}
          columns={[
            { key: 'spent_on', label: 'Date', render: (r) => fmtDate(r.spent_on) },
            { key: 'category', label: 'Category', render: (r) => <span className="font-semibold">{r.category}</span> },
            { key: 'description', label: 'Description', hideOnMobile: true },
            { key: 'amount', label: 'Amount', render: (r) => money(r.amount) },
          ]}
          fields={[
            { name: 'category', label: 'Category', type: 'select', required: true, options: ['Utilities', 'Rent', 'Supplies', 'Maintenance', 'Marketing', 'Salaries', 'Equipment', 'Insurance', 'Other'].map((v) => ({ value: v, label: v })) },
            { name: 'amount', label: 'Amount ($)', type: 'number', required: true }, { name: 'spent_on', label: 'Date', type: 'date', required: true },
            { name: 'description', label: 'Description', type: 'textarea' },
          ]}
        />
      )}
    </div>
  );
}
