'use client';
import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, Spinner } from '@/components/ui';
import { StatCard } from '@/components/ui/StatCard';
import BarChart from '@/components/admin/BarChart';
import ResourceManager from '@/components/admin/ResourceManager';
import { Tabs, Badge } from '@/components/ui';
import { useBranch } from '@/components/admin/branch';
import { money, titleCase, todayISO } from '@/lib/utils';

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

function group<T>(rows: T[], key: (r: T) => string, val: (r: T) => number) {
  const m: Record<string, number> = {};
  rows.forEach((r) => (m[key(r)] = (m[key(r)] || 0) + val(r)));
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function downloadCSV(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

export default function Reports() {
  const supabase = createClient();
  const [tab, setTab] = useState('overview');
  const { branchId } = useBranch();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayISO());
  const [d, setD] = useState<any>(null);

  const load = useCallback(async () => {
    setD(null);
    const start = new Date(`${from}T00:00:00`).toISOString();
    const end = new Date(new Date(`${to}T00:00:00`).getTime() + 864e5).toISOString();
    const [pay, sales, orders, exp, appts, items, saleItems, pats] = await Promise.all([
      supabase.from('payments').select('amount, method, created_at').gte('created_at', start).lt('created_at', end),
      (branchId ? supabase.from('pharmacy_daily_revenue').select('amount, day').eq('branch_id', branchId) : supabase.from('pharmacy_daily_revenue').select('amount, day')).gte('day', from).lte('day', to),
      supabase.from('orders').select('total, created_at, status').gte('created_at', start).lt('created_at', end).not('status', 'in', '(pending,cancelled)'),
      supabase.from('expenses').select('amount, category').gte('spent_on', from).lte('spent_on', to),
      supabase.from('appointments').select('status, doctors(full_name)').gte('scheduled_at', start).lt('scheduled_at', end),
      supabase.from('invoice_items').select('category, line_total, invoices!inner(created_at, status)').gte('invoices.created_at', start).lt('invoices.created_at', end).neq('invoices.status', 'void'),
      supabase.from('pharmacy_sale_items').select('quantity, line_total, medicines(name), pharmacy_sales!inner(created_at)').gte('pharmacy_sales.created_at', start).lt('pharmacy_sales.created_at', end),
      supabase.from('patients').select('id', { count: 'exact', head: true }).gte('created_at', start).lt('created_at', end),
    ]);
    const p = pay.data || [], s = sales.data || [], o = orders.data || [], e = exp.data || [];
    const collected = p.reduce((a, x) => a + Number(x.amount), 0);
    const pharmacy = s.reduce((a, x: any) => a + Number(x.amount), 0);
    const store = o.reduce((a, x) => a + Number(x.total), 0);
    const expenses = e.reduce((a, x) => a + Number(x.amount), 0);

    const daily: Record<string, number> = {};
    for (let t = new Date(`${from}T00:00:00`); t <= new Date(`${to}T00:00:00`); t.setDate(t.getDate() + 1)) daily[t.toDateString()] = 0;
    [...p.map((x) => [x.created_at, x.amount]), ...s.map((x: any) => [`${x.day}T12:00:00`, x.amount]), ...o.map((x) => [x.created_at, x.total])]
      .forEach(([at, amt]) => { const k = new Date(at as string).toDateString(); if (k in daily) daily[k] += Number(amt); });

    setD({
      collected, pharmacy, store, expenses, revenue: collected + pharmacy + store, newPatients: pats.count || 0,
      chart: Object.entries(daily).map(([k, v]) => ({ label: new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: v })),
      byMethod: group(p, (x) => titleCase(x.method), (x) => Number(x.amount)),
      byCategory: group(items.data || [], (x: any) => titleCase(x.category), (x: any) => Number(x.line_total)),
      byExpense: group(e, (x) => x.category, (x) => Number(x.amount)),
      byDoctor: group((appts.data || []).filter((x: any) => x.status === 'completed'), (x: any) => x.doctors?.full_name || 'Unknown', () => 1),
      topMeds: group(saleItems.data || [], (x: any) => x.medicines?.name || '-', (x: any) => Number(x.line_total)).slice(0, 8),
      appts: (appts.data || []).length,
      noShows: (appts.data || []).filter((x: any) => x.status === 'no_show').length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branchId]);

  useEffect(() => { load(); }, [load]);

  const exportAll = () => downloadCSV(`careplus-report-${from}-to-${to}.csv`, [
    ['Metric', 'Value'],
    ['Billing payments collected', d.collected], ['Pharmacy POS sales (net of refunds)', d.pharmacy], ['Online store sales', d.store],
    ['Total revenue', d.revenue], ['Expenses', d.expenses], ['Net', d.revenue - d.expenses],
    ['Appointments', d.appts], ['No-shows', d.noShows], ['New patients', d.newPatients],
    [], ['Daily revenue', ''], ...d.chart.map((c: any) => [c.label, c.value.toFixed(2)]),
  ]);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Financial and operational performance."
        actions={d && <button className="btn-secondary" onClick={exportAll}><Download size={16} /> Export CSV</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'scheduled', label: 'Scheduled emails' }]} />
      {tab === 'scheduled' ? (
        <>
          <p className="mb-4 text-sm text-ink-soft">Daily reports go out every morning, weekly on Mondays and monthly on the 1st (needs Resend email set up, see README).</p>
          <ResourceManager embedded table="report_schedules" title="Report emails" select="*, branches(name)"
            columns={[
              { key: 'name', label: 'Name', render: (r) => <span className="font-semibold">{r.name}</span> },
              { key: 'frequency', label: 'Frequency', render: (r) => <Badge tone="blue">{r.frequency}</Badge> },
              { key: 'recipients', label: 'Recipients', className: 'whitespace-normal max-w-xs text-xs' },
              { key: 'branch', label: 'Branch', render: (r) => r.branches?.name || 'All branches', hideOnMobile: true },
              { key: 'last_sent_at', label: 'Last sent', render: (r) => (r.last_sent_at ? new Date(r.last_sent_at).toLocaleString() : 'Never'), hideOnMobile: true },
              { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Active' : 'Paused'}</Badge> },
            ]}
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'frequency', label: 'Frequency', type: 'select', required: true, options: [{ value: 'daily', label: 'Daily (yesterday)' }, { value: 'weekly', label: 'Weekly (last 7 days, Mondays)' }, { value: 'monthly', label: 'Monthly (last month, on the 1st)' }] },
              { name: 'recipients', label: 'Recipient emails (comma separated)', required: true, full: true },
              { name: 'branch_id', label: 'Branch (blank = all)', type: 'select', optionsFrom: { table: 'branches', select: 'id, name', label: (r: any) => r.name, order: 'name' } },
              { name: 'active', label: 'Active', type: 'checkbox' },
            ]}
            defaults={{ frequency: 'weekly', active: true }}
          />
        </>
      ) : <>
      <div className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <label className="block"><span className="label">From</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block"><span className="label">To</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="flex gap-1">
          {[[6, '7d'], [29, '30d'], [89, '90d']].map(([n, l]) => <button key={l} className="btn-secondary btn-sm" onClick={() => { setFrom(daysAgo(n as number)); setTo(todayISO()); }}>{l}</button>)}
        </div>
      </div>

      {!d ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Total revenue" value={money(d.revenue)} hint={`Billing ${money(d.collected)}`} />
            <StatCard label="Pharmacy + store" value={money(d.pharmacy + d.store)} hint={`Store ${money(d.store)}`} tone="sky" />
            <StatCard label="Expenses" value={money(d.expenses)} tone="rose" />
            <StatCard label="Net" value={money(d.revenue - d.expenses)} hint={`${d.newPatients} new patients`} tone="violet" />
          </div>
          <div className="card p-5"><h2 className="mb-4 font-bold">Daily revenue</h2><BarChart data={d.chart} /></div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Breakdown title="Billed by service" rows={d.byCategory} money />
            <Breakdown title="Payments by method" rows={d.byMethod} money />
            <Breakdown title="Expenses by category" rows={d.byExpense} money />
            <Breakdown title="Top-selling medicines" rows={d.topMeds} money />
            <Breakdown title={`Completed visits by doctor (${d.appts} booked, ${d.noShows} no-show)`} rows={d.byDoctor} />
          </div>
        </div>
      )}
      </>}
    </div>
  );
}

function Breakdown({ title, rows, money: isMoney }: { title: string; rows: [string, number][]; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="card p-5">
      <h2 className="mb-4 text-sm font-bold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-ink-muted">No data.</p> : (
        <ul className="space-y-3">
          {rows.map(([k, v]) => (
            <li key={k}>
              <div className="flex justify-between text-sm"><span className="truncate pr-2">{k}</span><span className="font-semibold">{isMoney ? money(v) : v}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(v / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
