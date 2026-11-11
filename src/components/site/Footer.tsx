import Link from 'next/link';
import { HeartPulse, MapPin, Phone, Mail } from 'lucide-react';
import { getT } from '@/lib/i18n-server';

export default function Footer({ h }: { h: any }) {
  const t = getT();
  return (
    <footer className="mt-20 bg-ink text-slate-300">
      <div className="container-x grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 text-lg font-extrabold text-white"><HeartPulse className="text-brand-400" /> {h.name}</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{t('Compassionate, modern healthcare for the whole family. Board-certified specialists, on-site lab and pharmacy, 24/7 emergency care.')}</p>
        </div>
        <div>
          <p className="font-semibold text-white">{t('Patients')}</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/book" className="hover:text-white">{t('Book an appointment')}</Link></li>
            <li><Link href="/portal" className="hover:text-white">{t('Patient portal')}</Link></li>
            <li><Link href="/lab-tests" className="hover:text-white">{t('Lab tests & prices')}</Link></li>
            <li><Link href="/store" className="hover:text-white">{t('Health store')}</Link></li>
            <li><Link href="/ambulance" className="hover:text-white">{t('Request ambulance transport')}</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-white">{t('Hospital')}</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/departments" className="hover:text-white">{t('Departments')}</Link></li>
            <li><Link href="/doctors" className="hover:text-white">{t('Our doctors')}</Link></li>
            <li><Link href="/contact" className="hover:text-white">{t('Contact us')}</Link></li>
            <li><Link href="/login" className="hover:text-white">{t('Staff login')}</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-white">{t('Contact')}</p>
          <ul className="mt-3 space-y-3 text-sm">
            <li className="flex gap-2"><MapPin size={16} className="mt-0.5 shrink-0 text-brand-400" />{h.address}</li>
            <li className="flex gap-2"><Phone size={16} className="mt-0.5 shrink-0 text-brand-400" />{h.phone}</li>
            <li className="flex gap-2"><Mail size={16} className="mt-0.5 shrink-0 text-brand-400" />{h.email}</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-slate-500">© {new Date().getFullYear()} {h.name}. {t('All rights reserved.')}</div>
    </footer>
  );
}
