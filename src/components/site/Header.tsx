'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { HeartPulse, Menu, X, ShoppingCart, Phone, User } from 'lucide-react';
import { useCart } from './cart';
import { useT, LangToggle } from './lang';
import { cn } from '@/lib/utils';

const links = [
  { href: '/', label: 'Home' },
  { href: '/departments', label: 'Departments' },
  { href: '/doctors', label: 'Doctors' },
  { href: '/lab-tests', label: 'Lab Tests' },
  { href: '/store', label: 'Store' },
  { href: '/contact', label: 'Contact' },
];

export default function Header({ signedIn, phone }: { signedIn: boolean; phone: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const { count } = useCart();
  const t = useT();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="hidden bg-brand-800 text-xs text-brand-50 sm:block">
        <div className="container-x flex items-center justify-between py-1.5">
          <span>{t('24/7 Emergency:')} <a href={`tel:${phone}`} className="font-semibold">{phone}</a></span>
          <span>{t('Mon to Sat, 8:00 AM to 8:00 PM outpatient clinics')}</span>
        </div>
      </div>
      <div className="container-x flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white"><HeartPulse size={20} /></span>
          CarePlus
        </Link>
        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={cn('rounded-lg px-3 py-2 text-sm font-medium', (l.href === '/' ? path === '/' : path.startsWith(l.href)) ? 'text-brand-700' : 'text-ink-soft hover:text-ink')}>
              {t(l.label)}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 sm:gap-2">
          <LangToggle />
          <Link href="/cart" className="relative rounded-lg p-2 hover:bg-slate-100" aria-label="Cart">
            <ShoppingCart size={20} />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">{count}</span>}
          </Link>
          <Link href={signedIn ? '/portal' : '/login'} className="hidden rounded-lg p-2 hover:bg-slate-100 sm:block" aria-label="Account"><User size={20} /></Link>
          <Link href="/book" className="btn-primary hidden sm:inline-flex">{t('Book Appointment')}</Link>
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-white lg:hidden">
          <div className="container-x space-y-1 py-3">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-slate-50">{t(l.label)}</Link>
            ))}
            <Link href={signedIn ? '/portal' : '/login'} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-slate-50">{signedIn ? t('My Portal') : t('Sign in')}</Link>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <a href={`tel:${phone}`} className="btn-secondary"><Phone size={16} /> {t('Call')}</a>
              <Link href="/book" onClick={() => setOpen(false)} className="btn-primary">{t('Book now')}</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
