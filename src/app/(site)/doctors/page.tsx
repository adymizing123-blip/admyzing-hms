import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import DoctorCard from '@/components/site/DoctorCard';
import { cn } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Our Doctors' };

export default async function Doctors({ searchParams }: { searchParams: { department?: string } }) {
  const t = getT();
  const supabase = createClient();
  const { data: depts } = await supabase.from('departments').select('id, name, slug').order('name');
  const dept = depts?.find((d) => d.slug === searchParams.department);
  let q = supabase.from('doctors').select('*, departments(name)').eq('active', true).order('full_name');
  if (dept) q = q.eq('department_id', dept.id);
  const { data: doctors } = await q;

  return (
    <div className="container-x py-12">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('Our Doctors')}</h1>
      <p className="mt-2 text-ink-soft">{t('Choose a specialist and book a time that works for you.')}</p>
      <div className="-mx-4 mt-6 overflow-x-auto px-4">
        <div className="flex gap-2">
          <Link href="/doctors" className={cn('whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ring-1', !dept ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200')}>{t('All')}</Link>
          {(depts || []).map((d) => (
            <Link key={d.id} href={`/doctors?department=${d.slug}`}
              className={cn('whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ring-1', dept?.id === d.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200')}>
              {d.name}
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {(doctors || []).map((d) => <DoctorCard key={d.id} d={d} />)}
      </div>
      {doctors?.length === 0 && <p className="py-12 text-center text-ink-muted">{t('No doctors found in this department.')}</p>}
    </div>
  );
}
