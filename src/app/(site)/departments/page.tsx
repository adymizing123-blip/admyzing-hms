import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import DeptIcon from '@/components/site/DeptIcon';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Departments' };

export default async function Departments() {
  const t = getT();
  const supabase = createClient();
  const { data: depts } = await supabase.from('departments').select('*, doctors(id)').order('name');
  return (
    <div className="container-x py-12">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('Departments')}</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{t('Specialized teams working together for your health.')}</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {(depts || []).map((d: any) => (
          <div key={d.id} className="card flex flex-col p-6">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-600"><DeptIcon name={d.icon} /></span>
            <h2 className="mt-4 text-lg font-bold">{d.name}</h2>
            <p className="mt-1 flex-1 text-sm text-ink-soft">{d.description}</p>
            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-ink-muted">{d.doctors?.length || 0} {t('doctor(s)')}</span>
              <Link href={`/doctors?department=${d.slug}`} className="btn-secondary btn-sm">{t('View doctors')}</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
