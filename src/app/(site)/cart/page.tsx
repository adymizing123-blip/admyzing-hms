'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Minus, Plus, Trash2, ShoppingCart } from 'lucide-react';
import { useCart } from '@/components/site/cart';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';
import { money } from '@/lib/utils';
import { SHIPPING_FLAT, SHIPPING_FREE_OVER } from '@/lib/store';
import { useT } from '@/components/site/lang';


export default function CartPage() {
  const t = useT();
  const { items, update, remove, subtotal, clear } = useCart();
  const [form, setForm] = useState({ customer_name: '', email: '', phone: '', address: '', city: '', state: '', zip: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from('patients').select('*').eq('profile_id', user.id).maybeSingle();
      if (p) setForm((f) => ({ ...f, customer_name: `${p.first_name} ${p.last_name === '-' ? '' : p.last_name}`.trim(), email: p.email || '', phone: p.phone || '', address: p.address || '', city: p.city || '', state: p.state || '', zip: p.zip || '' }));
    })();
  }, []);

  const shipping = subtotal === 0 || subtotal >= SHIPPING_FREE_OVER ? 0 : SHIPPING_FLAT;

  const checkout = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ id: i.id, quantity: i.quantity })), customer: form }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || 'Checkout failed');
    clear();
    window.location.href = data.url;
  };

  if (items.length === 0) {
    return (
      <div className="container-x py-20 text-center">
        <ShoppingCart size={48} className="mx-auto text-ink-muted" />
        <h1 className="mt-4 text-2xl font-bold">{t('Your cart is empty')}</h1>
        <Link href="/store" className="btn-primary mt-6">{t('Browse the store')}</Link>
      </div>
    );
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="container-x py-10">
      <h1 className="text-3xl font-extrabold tracking-tight">{t('Cart & checkout')}</h1>
      <div className="mt-8 grid gap-8 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          {items.map((i) => (
            <div key={i.id} className="card flex items-center gap-4 p-3 sm:p-4">
              <img src={i.image_url || ''} alt="" className="h-16 w-16 shrink-0 rounded-xl bg-slate-100 object-cover sm:h-20 sm:w-20" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{i.name}</p>
                <p className="text-sm text-ink-soft">{money(i.price)}</p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-slate-200">
                    <button className="p-1.5" onClick={() => update(i.id, i.quantity - 1)} aria-label="Decrease"><Minus size={14} /></button>
                    <span className="w-7 text-center text-sm font-semibold">{i.quantity}</span>
                    <button className="p-1.5" onClick={() => update(i.id, i.quantity + 1)} aria-label="Increase"><Plus size={14} /></button>
                  </div>
                  <button className="p-1.5 text-rose-600" onClick={() => remove(i.id)} aria-label="Remove"><Trash2 size={16} /></button>
                </div>
              </div>
              <p className="font-bold">{money(i.price * i.quantity)}</p>
            </div>
          ))}
        </div>
        <form onSubmit={checkout} className="card h-fit space-y-4 p-5 sm:p-6 lg:col-span-2">
          <h2 className="font-bold">{t('Shipping details')}</h2>
          {error && <Alert>{error}</Alert>}
          <input className="input" placeholder={t('Full name')} required value={form.customer_name} onChange={set('customer_name')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" type="email" placeholder={t('Email')} required value={form.email} onChange={set('email')} />
            <input className="input" type="tel" placeholder={t('Phone')} value={form.phone} onChange={set('phone')} />
          </div>
          <input className="input" placeholder={t('Street address')} required value={form.address} onChange={set('address')} />
          <div className="grid grid-cols-3 gap-3">
            <input className="input" placeholder={t('City')} required value={form.city} onChange={set('city')} />
            <input className="input" placeholder={t('State')} required maxLength={2} value={form.state} onChange={set('state')} />
            <input className="input" placeholder={t('ZIP')} required value={form.zip} onChange={set('zip')} />
          </div>
          <div className="space-y-2 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between"><span className="text-ink-soft">{t('Subtotal')}</span><span>{money(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-ink-soft">{t('Shipping')}</span><span>{shipping ? money(shipping) : 'Free'}</span></div>
            <div className="flex justify-between"><span className="text-ink-soft">{t('Sales tax')}</span><span>{t('Calculated at payment')}</span></div>
            <div className="flex justify-between pt-2 text-base font-bold"><span>{t('Total')}</span><span>{money(subtotal + shipping)}</span></div>
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Proceed to payment</button>
        </form>
      </div>
    </div>
  );
}
