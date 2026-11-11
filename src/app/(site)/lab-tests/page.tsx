import { createClient } from '@/lib/supabase/server';
import { money } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Lab Tests & Prices' };

export default async function LabTests() {
  const t = getT();
  const supabase = createClient();
  const { data: tests } = await supabase.from('lab_tests').select('*').eq('active', true).order('category').order('name');
  const groups = (tests || []).reduce((acc: Record<string, any[]>, x) => ((acc[x.category || 'Other'] ||= []).push(x), acc), {});
  return (
    <div className="container-x py-12">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('Lab Tests & Imaging')}</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">{t('Transparent self-pay prices. Results are available in your patient portal.')}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {(Object.entries(groups) as [string, any[]][]).map(([cat, list]) => (
          <div key={cat} className="card overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3 font-bold">{cat}</div>
            <ul className="divide-y divide-slate-100">
              {list.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-semibold">{x.name}</p>
                    <p className="text-xs text-ink-muted">{x.sample_type} · {t('Results in')} ~{x.turnaround_hours}h</p>
                  </div>
                  <span className="text-sm font-bold">{money(x.price)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
