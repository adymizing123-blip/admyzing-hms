'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Menu, X, LogOut, HeartPulse, LayoutDashboard, Users, CalendarDays, Stethoscope, BedDouble, Scissors, FlaskConical,
  ShoppingCart, Pill, Store, Boxes, Receipt, Megaphone, UserCog, BarChart3, Settings, Circle,
  Siren, Droplets, Share2, Ambulance, Utensils, Inbox, Upload, Syringe, Building2, FileText, MessagesSquare, Workflow,
} from 'lucide-react';
import IdleLogout from './IdleLogout';
import { BranchContext } from './branch';

const Icons: Record<string, any> = {
  LayoutDashboard, Users, CalendarDays, Stethoscope, BedDouble, Scissors, FlaskConical,
  ShoppingCart, Pill, Store, Boxes, Receipt, Megaphone, UserCog, BarChart3, Settings,
  Siren, Droplets, Share2, Ambulance, Utensils, Inbox, Upload, Syringe, Building2, FileText, MessagesSquare, Workflow,
};
import { navFor } from '@/lib/nav';
import { cn, titleCase, type Role } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

export default function Shell({ role, name, children, idleMinutes = 15, branches = [], branchId = null, limited = false }: {
  role: Role; name: string; children: React.ReactNode; idleMinutes?: number;
  branches?: { id: string; name: string; address?: string | null; timings?: string | null }[]; branchId?: string | null; limited?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const groups = limited ? [] : navFor(role);

  const switchBranch = async (id: string) => {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('profiles').update({ branch_id: id }).eq('id', user!.id);
    router.refresh();
  };

  const isActive = (href: string) =>
    href === '/admin' ? path === '/admin' : path === href || (path.startsWith(href + '/') && !(href === '/admin/pharmacy' && path.startsWith('/admin/pharmacy/pos')));

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href="/admin" className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white"><HeartPulse size={20} /></span>
        <span className="text-lg font-extrabold tracking-tight">CarePlus <span className="text-brand-600">HMS</span></span>
      </Link>
      {branches.length > 1 && (
        <div className="px-4 pb-3">
          <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
            <Building2 size={16} className="shrink-0 text-brand-600" />
            <select className="w-full bg-transparent font-semibold outline-none" value={branchId || ''} onChange={(e) => switchBranch(e.target.value)} aria-label="Branch">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {(() => { const cur = branches.find((b) => b.id === branchId); return cur && (cur.address || cur.timings) ? (
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-ink-muted">{[cur.address, cur.timings].filter(Boolean).join(' · ')}</p>
          ) : null; })()}
        </div>
      )}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((i) => {
                const Icon = Icons[i.icon] || Circle;
                const active = isActive(i.href);
                return (
                  <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
                    className={cn('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                      active ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30' : 'text-ink-soft hover:bg-slate-100 hover:text-ink')}>
                    <Icon size={18} /> {i.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
            {(name || '?').slice(0, 1).toUpperCase()}
          </span>
          <Link href="/admin/account" onClick={() => setOpen(false)} className="min-w-0 flex-1 hover:opacity-80">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-xs text-ink-muted">{titleCase(role)} · My account</p>
          </Link>
          <button onClick={signOut} className="rounded-lg p-2 text-ink-soft hover:bg-slate-100" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl">
            <button className="absolute right-3 top-5 rounded-lg p-1.5 hover:bg-slate-100" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
            {sidebar}
          </aside>
        </div>
      )}

      <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur lg:hidden">
        <button className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
        <span className="font-extrabold">CarePlus <span className="text-brand-600">HMS</span></span>
      </header>

      <BranchContext.Provider value={{ branchId, branches }}>
        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </BranchContext.Provider>
      <IdleLogout minutes={idleMinutes} />
    </div>
  );
}
