import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Truck, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import AddToCart from '@/components/site/AddToCart';
import { money } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';

export default async function Product({ params }: { params: { slug: string } }) {
  const t = getT();
  const supabase = createClient();
  const { data: p } = await supabase.from('products').select('*').eq('slug', params.slug).eq('active', true).maybeSingle();
  if (!p) notFound();
  return (
    <div className="container-x py-10">
      <Link href="/store" className="text-sm font-semibold text-brand-700">{t('← Back to store')}</Link>
      <div className="mt-6 grid gap-8 md:grid-cols-2 lg:gap-14">
        <div className="aspect-square overflow-hidden rounded-3xl bg-slate-100">
          {p.image_url && <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />}
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{p.category}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{p.name}</h1>
          <p className="mt-4 text-3xl font-bold">{money(p.price)}</p>
          <p className="mt-5 leading-relaxed text-ink-soft">{p.description}</p>
          <p className="mt-4 text-sm">{p.stock > 0 ? <span className="font-semibold text-emerald-600">{t('In stock')}</span> : <span className="font-semibold text-rose-600">{t('Out of stock')}</span>}</p>
          <div className="mt-6 max-w-sm"><AddToCart product={p} withQty /></div>
          <div className="mt-8 space-y-3 border-t border-slate-200 pt-6 text-sm text-ink-soft">
            <p className="flex items-center gap-2"><Truck size={18} className="text-brand-600" /> {t('Free shipping on orders over $75')}</p>
            <p className="flex items-center gap-2"><ShieldCheck size={18} className="text-brand-600" /> {t('Dispensed by our licensed hospital pharmacy')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
