import Link from 'next/link';
import { HeartPulse } from 'lucide-react';
import SignOutButton from '@/components/portal/SignOutButton';
import { LangToggle } from '@/components/site/lang';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Patient Portal' };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const t = getT();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="container-x flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-extrabold"><HeartPulse className="text-brand-600" /> CarePlus <span className="hidden font-medium text-ink-soft sm:inline">{t('Patient Portal')}</span></Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <LangToggle />
            <Link href="/book" className="btn-primary btn-sm">{t('Book visit')}</Link>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="container-x py-8">{children}</main>
    </div>
  );
}
