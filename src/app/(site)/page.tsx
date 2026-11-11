import Link from 'next/link';
import { ArrowRight, Ambulance, FlaskConical, Pill, Video, ShieldCheck, Clock, CalendarDays } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import DeptIcon from '@/components/site/DeptIcon';
import DoctorCard from '@/components/site/DoctorCard';
import { money } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';

export default async function Home() {
  const t = getT();
  const supabase = createClient();
  const [{ data: depts }, { data: doctors }, { data: packages }] = await Promise.all([
    supabase.from('departments').select('*').order('name'),
    supabase.from('doctors').select('*, departments(name)').eq('active', true).limit(4),
    supabase.from('products').select('*').eq('category', 'Health Packages').eq('active', true).limit(3),
  ]);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-white to-sky-50">
        <div className="container-x grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
              <ShieldCheck size={14} /> {t('Board-certified specialists')}
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              {t('Expert care,')} <span className="text-brand-600">{t('close to home.')}</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-ink-soft">
              {t('Book a visit in under a minute, get lab results online and order health essentials from our pharmacy. All in one place.')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/book" className="btn-primary px-6 py-3 text-base"><CalendarDays size={18} /> {t('Book Appointment')}</Link>
              <Link href="/doctors" className="btn-secondary px-6 py-3 text-base">{t('Find a Doctor')} <ArrowRight size={18} /></Link>
            </div>
            <div className="mt-10 grid max-w-md grid-cols-3 gap-4">
              {[['8+', 'Specialties'], ['24/7', 'Emergency'], ['30', 'Beds']].map(([n, l]) => (
                <div key={l}><p className="text-2xl font-extrabold text-ink">{n}</p><p className="text-xs text-ink-soft">{t(l)}</p></div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="aspect-[4/3] overflow-hidden rounded-3xl shadow-2xl lg:aspect-[5/5]">
              <img src="https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=1200&q=80" alt="Doctor with patient" className="h-full w-full object-cover" />
            </div>
            <div className="absolute -bottom-5 left-4 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-xl sm:left-[-1.5rem]">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-rose-50 text-rose-600"><Ambulance /></span>
              <div><p className="text-sm font-bold">{t('Emergency 24/7')}</p><p className="text-xs text-ink-soft">{t('Walk in any time')}</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="container-x -mt-2 grid gap-4 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: <CalendarDays />, t: 'Online Booking', d: 'Pick a doctor and a time slot that suits you.', href: '/book' },
          { icon: <FlaskConical />, t: 'Lab & Imaging', d: 'On-site lab, X-ray, ultrasound and MRI.', href: '/lab-tests' },
          { icon: <Pill />, t: 'Pharmacy & Store', d: 'Medicines, devices and supplements delivered.', href: '/store' },
          { icon: <Video />, t: 'Patient Portal', d: 'Prescriptions, reports and bills online.', href: '/portal' },
        ].map((s) => (
          <Link key={s.t} href={s.href} className="card group p-6 transition hover:-translate-y-1 hover:shadow-lg">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">{s.icon}</span>
            <h3 className="mt-4 font-bold">{t(s.t)}</h3>
            <p className="mt-1 text-sm text-ink-soft">{t(s.d)}</p>
          </Link>
        ))}
      </section>

      {/* Departments */}
      <section className="bg-white py-16">
        <div className="container-x">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-semibold text-brand-700">{t('Departments')}</p>
              <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{t('Care for every stage of life')}</h2>
            </div>
            <Link href="/departments" className="text-sm font-semibold text-brand-700">{t('View all departments →')}</Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {(depts || []).map((d) => (
              <Link key={d.id} href={`/doctors?department=${d.slug}`} className="rounded-2xl border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50/50 sm:p-5">
                <span className="text-brand-600"><DeptIcon name={d.icon} size={26} /></span>
                <p className="mt-3 font-semibold">{d.name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{d.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Doctors */}
      <section className="container-x py-16">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold text-brand-700">{t('Our team')}</p>
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{t('Meet our specialists')}</h2>
          </div>
          <Link href="/doctors" className="text-sm font-semibold text-brand-700">{t('All doctors →')}</Link>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {(doctors || []).map((d) => <DoctorCard key={d.id} d={d} />)}
        </div>
      </section>

      {/* Packages */}
      {packages && packages.length > 0 && (
        <section className="bg-brand-900 py-16 text-white">
          <div className="container-x">
            <p className="text-sm font-semibold text-brand-300">{t('Health packages')}</p>
            <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{t('Preventive checkups, one simple price')}</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {packages.map((p) => (
                <div key={p.id} className="flex flex-col rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="mt-2 flex-1 text-sm text-brand-100/80">{p.description}</p>
                  <div className="mt-6 flex items-center justify-between">
                    <span className="text-2xl font-extrabold">{money(p.price)}</span>
                    <Link href={`/store/${p.slug}`} className="btn bg-white text-brand-800 hover:bg-brand-50">{t('Book package')}</Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="container-x py-16">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-gradient-to-r from-brand-600 to-brand-700 p-8 text-white sm:p-12 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl">{t('Need to see a doctor?')}</h2>
            <p className="mt-2 flex items-center gap-2 text-brand-50"><Clock size={16} /> {t('Same-day appointments available.')}</p>
          </div>
          <Link href="/book" className="btn bg-white px-6 py-3 text-base text-brand-800 hover:bg-brand-50">{t('Book now')} <ArrowRight size={18} /></Link>
        </div>
      </section>
    </>
  );
}
