import Link from 'next/link';
import { ChannelDot, sourceMeta } from './ChannelBadge';
import { cn } from '@/lib/utils';

/** Dashboard: where leads and patients come from, chats per channel, and each clinic's numbers (all clinics). */
export default function GrowthPanel({ g, days }: { g: any; days: number }) {
  const leads: any[] = g?.leads_by_source || [];
  const patients: any[] = g?.patients_by_source || [];
  const chats: any[] = g?.chats_by_channel || [];
  const clinics: any[] = g?.by_clinic || [];
  const maxLead = Math.max(1, ...leads.map((x) => Number(x.total)));
  const maxPat = Math.max(1, ...patients.map((x) => Number(x.total)));
  const leadTotal = leads.reduce((a, x) => a + Number(x.total), 0);
  const convTotal = leads.reduce((a, x) => a + Number(x.converted), 0);

  const Bars = ({ rows, max, conv }: { rows: any[]; max: number; conv?: boolean }) => (
    rows.length === 0 ? <p className="py-6 text-center text-sm text-ink-muted">Nothing in this period.</p> : (
      <ul className="space-y-3">
        {rows.map((r) => {
          const m = sourceMeta(r.source);
          return (
            <li key={r.source}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2"><span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', m.dot)} /><span className="truncate">{m.label}</span></span>
                <span className="shrink-0 font-semibold">{r.total}{conv && <span className="ml-1 text-xs font-normal text-ink-muted">· {r.converted} became patients</span>}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100"><div className={cn('h-2 rounded-full', m.dot)} style={{ width: `${(Number(r.total) / max) * 100}%` }} /></div>
            </li>
          );
        })}
      </ul>
    )
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Leads, patients and chats <span className="font-normal text-ink-soft">(all clinics)</span></h2>
        <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/admin?days=${d}`} scroll={false} className={cn('rounded-lg px-3 py-1 text-xs font-semibold', d === days ? 'bg-white shadow-sm' : 'text-ink-soft hover:text-ink')}>{d} days</Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="font-bold">Where leads come from</h3>
            <span className="text-xs text-ink-soft">{leadTotal} leads · {leadTotal ? Math.round((convTotal / leadTotal) * 100) : 0}% converted</span>
          </div>
          <Bars rows={leads} max={maxLead} conv />
          <Link href="/admin/crm" className="mt-4 block text-sm font-semibold text-brand-700">Open CRM →</Link>
        </div>
        <div className="card p-5">
          <h3 className="mb-4 font-bold">New patients by source</h3>
          <Bars rows={patients} max={maxPat} />
          <Link href="/admin/patients" className="mt-4 block text-sm font-semibold text-brand-700">All patients →</Link>
        </div>
        <div className="card p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="font-bold">Chats by channel</h3>
            {g?.unread_chats ? <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">{g.unread_chats} unread</span> : null}
          </div>
          {chats.length === 0 ? <p className="py-6 text-center text-sm text-ink-muted">No chats yet. Connect WhatsApp, Facebook and Instagram in Chats.</p> : (
            <ul className="divide-y divide-slate-100">
              {chats.map((c) => (
                <li key={c.channel} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-semibold"><ChannelDot channel={c.channel} className="h-6 min-w-6" />{sourceMeta(c.channel).label}</span>
                  <span className="text-right text-xs text-ink-soft">
                    <span className="block text-sm font-bold text-ink">{c.messages_in} <span className="text-xs font-normal text-ink-soft">messages in</span></span>
                    {c.new_chats} new · {c.open} open{Number(c.unread) ? <span className="font-semibold text-brand-700"> · {c.unread} unread</span> : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/chats" className="mt-4 block text-sm font-semibold text-brand-700">Open chats →</Link>
        </div>
      </div>

      {clinics.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="th">Clinic</th><th className="th text-right">Visits</th><th className="th text-right">New patients</th><th className="th text-right">Leads</th><th className="th text-right">Chats</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {clinics.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-semibold"><Link href={`/admin/clinics?clinic=${c.id}`} className="hover:text-brand-700">{c.name}</Link></td>
                    <td className="px-4 py-2.5 text-right">{c.visits}</td>
                    <td className="px-4 py-2.5 text-right">{c.new_patients}</td>
                    <td className="px-4 py-2.5 text-right">{c.leads}</td>
                    <td className="px-4 py-2.5 text-right">{c.chats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
