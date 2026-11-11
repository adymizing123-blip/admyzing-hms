import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import AddToCart from '@/components/site/AddToCart';
import { cn, money } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Health Store' };

export default async function Store({ searchParams }: { searchParams: { category?: string; q?: string } }) {
  const t = getT();
  const supabase = createClient();
  const { data: all } = await supabase.from('products').select('category').eq('active', true);
  const cats = Array.from(new Set((all || []).map((p) => p.category).filter(Boolean))).sort();
  let q = supabase.from('products').select('*').eq('active', true).order('name');
  if (searchParams.category) q = q.eq('category', searchParams.category);
  if (searchParams.q) q = q.ilike('name', `%${searchParams.q}%`);
  const { data: products } = await q;

  return (
    <div className="container-x py-12">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('Health Store')}</h1>
          <p className="mt-2 text-ink-soft">{t('Devices, supplements, first aid and health packages. Ships within the US.')}</p>
        </div>
        <form className="w-full sm:w-72"><input name="q" defaultValue={searchParams.q} className="input" placeholder={t('Search products...')} /></form>
      </div>
      <div className="-mx-4 mt-6 overflow-x-auto px-4">
        <div className="flex gap-2">
          <Link href="/store" className={cn('whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ring-1', !searchParams.category ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200')}>{t('All')}</Link>
          {cats.map((c) => (
            <Link key={c} href={`/store?category=${encodeURIComponent(c)}`}
              className={cn('whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ring-1', searchParams.category === c ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200')}>{c}</Link>
          ))}
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
        {(products || []).map((p) => (
          <div key={p.id} className="card group flex flex-col overflow-hidden">
            <Link href={`/store/${p.slug}`} className="aspect-square overflow-hidden bg-slate-100">
              {p.image_url && <img src={p.image_url} alt={p.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />}
            </Link>
            <div className="flex flex-1 flex-col p-3 sm:p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">{p.category}</p>
              <Link href={`/store/${p.slug}`} className="mt-1 line-clamp-2 text-sm font-semibold sm:text-base">{p.name}</Link>
              <div className="mt-auto flex flex-col gap-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-bold">{money(p.price)}</span>
                <AddToCart product={p} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {products?.length === 0 && <p className="py-12 text-center text-ink-muted">{t('No products found.')}</p>}
    </div>
  );
}
