import type { SupabaseClient } from '@supabase/supabase-js';
import { money } from './utils';

/** Key numbers for a date range (inclusive), optionally for one branch. Used by scheduled report emails. */
export async function reportSummary(db: SupabaseClient, from: string, to: string, branchId?: string | null) {
  const start = new Date(`${from}T00:00:00Z`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 864e5).toISOString();
  const br = <T,>(q: T): T => (branchId ? (q as any).eq('branch_id', branchId) : q);

  const [pay, pharm, store, exp, appts, pats, adm] = await Promise.all([
    db.from('payments').select('amount, invoices!inner(branch_id)').gte('created_at', start).lt('created_at', end).then((r) => ({ ...r, data: (r.data || []).filter((x: any) => !branchId || x.invoices?.branch_id === branchId) })),
    br(db.from('pharmacy_daily_revenue').select('amount, branch_id').gte('day', from).lte('day', to)),
    db.from('orders').select('total').gte('created_at', start).lt('created_at', end).not('status', 'in', '(pending,cancelled)'),
    db.from('expenses').select('amount').gte('spent_on', from).lte('spent_on', to),
    br(db.from('appointments').select('status, branch_id').gte('scheduled_at', start).lt('scheduled_at', end)),
    db.from('patients').select('id', { count: 'exact', head: true }).gte('created_at', start).lt('created_at', end),
    br(db.from('admissions').select('id, branch_id').gte('admitted_at', start).lt('admitted_at', end)),
  ]);
  const sum = (rows: any[] | null, k: string) => (rows || []).reduce((s, r) => s + Number(r[k] || 0), 0);
  const billing = sum(pay.data, 'amount'), pharmacy = sum((pharm as any).data, 'amount'), online = sum(store.data, 'total'), expenses = sum(exp.data, 'amount');
  const a = ((appts as any).data || []) as any[];
  return {
    billing, pharmacy, online, expenses, revenue: billing + pharmacy + online, net: billing + pharmacy + online - expenses,
    appointments: a.length, completed: a.filter((x) => x.status === 'completed').length, noShows: a.filter((x) => x.status === 'no_show').length,
    newPatients: pats.count || 0, admissions: ((adm as any).data || []).length,
  };
}

export function summaryText(title: string, from: string, to: string, s: Awaited<ReturnType<typeof reportSummary>>, hospital: string) {
  return [
    `${title}`,
    `${hospital} · ${from === to ? from : `${from} to ${to}`}`,
    '',
    `Total revenue: ${money(s.revenue)}`,
    `  Billing payments: ${money(s.billing)}`,
    `  Pharmacy (net of refunds): ${money(s.pharmacy)}`,
    `  Online store: ${money(s.online)}`,
    `Expenses: ${money(s.expenses)}`,
    `Net: ${money(s.net)}`,
    '',
    `Appointments: ${s.appointments} (completed ${s.completed}, no-shows ${s.noShows})`,
    `New patients: ${s.newPatients}`,
    `Admissions: ${s.admissions}`,
    '',
    'Full reports: sign in and open Reports.',
  ].join('\n');
}
