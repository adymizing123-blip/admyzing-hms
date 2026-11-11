import Link from 'next/link';
import { CalendarDays, BedDouble, DollarSign, Users, AlertTriangle, FlaskConical, Megaphone, Package, Receipt, Siren, Inbox, Droplets } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui';
import BarChart from '@/components/admin/BarChart';
import { fmtTime, fullName, money, titleCase } from '@/lib/utils';
import { Building2, MessagesSquare, Workflow } from 'lucide-react';
import GrowthPanel from '@/components/admin/GrowthPanel';

export default async function Dashboard({ searchParams }: { searchParams?: { days?: string } }) {
  const days = [7, 30, 90].includes(Number(searchParams?.days)) ? Number(searchParams?.days) : 30;
  const { supabase, profile } = await getSessionProfile();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);

  const [{ data: s }, { data: today }, { data: lowStock }, { data: expiring }, { data: growth }] = await Promise.all([
    supabase.rpc('dashboard_stats'),
    supabase.from('appointments').select('id, scheduled_at, status, token_no, patients(first_name,last_name,mrn), doctors(full_name), branches(name)')
      .gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString()).order('scheduled_at').limit(8),
    supabase.from('medicine_stock').select('id, name, stock, reorder_level').eq('active', true).order('stock').limit(50),
    supabase.from('expiring_batches').select('id, medicine_name, batch_no, expiry_date, quantity').limit(5),
    supabase.rpc('growth_stats', { p_days: days }),
  ]);

  const stats = s || {};

  // patients who came to each clinic today (all clinics, not just the one selected in the sidebar)
  const [{ data: clinicList }, { data: todayAll }] = await Promise.all([
    supabase.from('branches').select('id, name').eq('active', true).order('name'),
    supabase.from('appointments').select('branch_id, status').gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString()).not('status', 'in', '(cancelled,no_show)'),
  ]);
  const byClinic = (clinicList || []).map((c: any) => {
    const rows = (todayAll || []).filter((a: any) => a.branch_id === c.id);
    return { ...c, total: rows.length, waiting: rows.filter((a: any) => ['booked', 'checked_in', 'in_consultation'].includes(a.status)).length, done: rows.filter((a: any) => a.status === 'completed').length };
  });
  const low = (lowStock || []).filter((m: any) => m.stock <= m.reorder_level).slice(0, 5);
  const chart = (stats.revenue_30d || []).map((r: any) => ({
    label: new Date(r.day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: Number(r.amount),
  }));
  const byCat = (stats.revenue_by_category || []).filter((c: any) => Number(c.amount) > 0);
  const catTotal = byCat.reduce((a: number, c: any) => a + Number(c.amount), 0) || 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {profile?.full_name?.split(' ')[0]}</h1>
        <p className="text-sm text-ink-soft">Here is what is happening at {stats.branch || 'the hospital'} today.</p>
      </div>

      {byClinic.length > 1 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Patients by clinic today</h2>
            <Link href="/admin/clinics" className="text-sm font-semibold text-brand-700">All clinics →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {byClinic.map((c: any) => (
              <Link key={c.id} href={`/admin/clinics?clinic=${c.id}`} className="card p-4 hover:border-brand-200">
                <p className="flex items-center gap-2 text-sm font-bold"><Building2 size={15} className="text-brand-600" /><span className="truncate">{c.name}</span></p>
                <p className="mt-2 text-2xl font-extrabold">{c.total}</p>
                <p className="text-xs text-ink-soft">{c.waiting} waiting · {c.done} seen</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <GrowthPanel g={growth} days={days} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Appointments today" value={stats.appointments_today ?? 0} hint={`${stats.waiting ?? 0} waiting now`} icon={<CalendarDays size={20} />} />
        <StatCard label="Admitted patients" value={stats.admitted ?? 0} hint={`${stats.beds_available ?? 0} of ${stats.beds_total ?? 0} beds free`} icon={<BedDouble size={20} />} tone="sky" />
        <StatCard label="Revenue today" value={money(stats.revenue_today)} hint={`${money(stats.outstanding)} outstanding`} icon={<DollarSign size={20} />} tone="violet" />
        <StatCard label="Total patients" value={stats.patients_total ?? 0} hint={`${stats.new_leads ?? 0} new leads`} icon={<Users size={20} />} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold">Revenue, last 30 days</h2>
            <span className="text-sm font-semibold text-brand-700">{money(chart.reduce((a: number, c: any) => a + c.value, 0))}</span>
          </div>
          <BarChart data={chart} />
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-bold">Revenue by source (30d)</h2>
          {byCat.length === 0 ? <p className="text-sm text-ink-muted">No revenue yet.</p> : (
            <ul className="space-y-3">
              {byCat.map((c: any) => (
                <li key={c.category}>
                  <div className="flex justify-between text-sm"><span>{titleCase(c.category)}</span><span className="font-semibold">{money(c.amount)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(Number(c.amount) / catTotal) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold">Today&apos;s appointments</h2>
            <Link href="/admin/opd" className="text-sm font-semibold text-brand-700">Open queue →</Link>
          </div>
          <ul className="divide-y divide-slate-100">
            {(today || []).length === 0 && <li className="px-5 py-10 text-center text-sm text-ink-muted">No appointments today.</li>}
            {(today || []).map((a: any) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold">{fmtTime(a.scheduled_at)}</span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold"><span className="truncate">{fullName(a.patients)}</span>{a.branches?.name && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700"><Building2 size={11} />{a.branches.name}</span>}</p>
                    <p className="truncate text-xs text-ink-soft">{a.doctors?.full_name} · Token #{a.token_no}</p>
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <h2 className="font-bold">Alerts</h2>
          {[
            { href: '/admin/chats', icon: <MessagesSquare size={18} />, l: 'Unread chats (WA, FB, Insta)', v: growth?.unread_chats },
            { href: '/admin/emergency', icon: <Siren size={18} />, l: 'Patients in the ER', v: stats.er_waiting },
            { href: '/admin/inbox', icon: <Inbox size={18} />, l: 'Unread patient messages', v: stats.unread_messages },
            { href: '/admin/inbox', icon: <Receipt size={18} />, l: 'Refill requests', v: stats.pending_refills },
            { href: '/admin/blood-bank', icon: <Droplets size={18} />, l: 'Blood groups low on stock', v: stats.blood_low },
            { href: '/admin/lab', icon: <FlaskConical size={18} />, l: 'Pending lab orders', v: stats.pending_labs },
            { href: '/admin/store', icon: <Package size={18} />, l: 'Store orders to ship', v: stats.pending_orders },
            { href: '/admin/crm', icon: <Megaphone size={18} />, l: 'New leads', v: stats.new_leads },
            { href: '/admin/billing', icon: <Receipt size={18} />, l: 'Outstanding bills', v: money(stats.outstanding) },
            ...(growth?.automations_failed ? [{ href: '/admin/automations', icon: <Workflow size={18} />, l: 'Automations failed (24h)', v: growth.automations_failed }] : []),
          ].map((a) => (
            <Link key={a.l} href={a.href} className="card flex items-center justify-between p-4 hover:border-brand-200">
              <span className="flex items-center gap-3 text-sm font-medium"><span className="text-brand-600">{a.icon}</span>{a.l}</span>
              <span className="font-bold">{a.v ?? 0}</span>
            </Link>
          ))}
          {(low.length > 0 || (expiring || []).length > 0) && (
            <div className="card border-amber-200 bg-amber-50/50 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-800"><AlertTriangle size={16} /> Pharmacy alerts</p>
              <ul className="mt-2 space-y-1 text-sm">
                {low.map((m: any) => <li key={m.id} className="flex justify-between"><span>{m.name}</span><span className="font-semibold text-rose-600">{m.stock} left</span></li>)}
                {(expiring || []).map((b: any) => <li key={b.id} className="flex justify-between"><span>{b.medicine_name} ({b.batch_no})</span><span className="text-amber-700">exp {b.expiry_date}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
