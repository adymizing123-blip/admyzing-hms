'use client';
import { useState } from 'react';
import { Check, Minus, Plus, ShoppingCart } from 'lucide-react';
import { useCart } from './cart';
import { useT } from './lang';

export default function AddToCart({ product, withQty }: { product: any; withQty?: boolean }) {
  const t = useT();
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const out = product.stock <= 0;

  const onAdd = () => {
    add({ id: product.id, name: product.name, price: Number(product.price), image_url: product.image_url }, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="flex items-center gap-2">
      {withQty && (
        <div className="flex items-center rounded-xl border border-slate-200">
          <button className="p-2.5" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease"><Minus size={16} /></button>
          <span className="w-8 text-center text-sm font-semibold">{qty}</span>
          <button className="p-2.5" onClick={() => setQty(qty + 1)} aria-label="Increase"><Plus size={16} /></button>
        </div>
      )}
      <button className={withQty ? 'btn-primary flex-1' : 'btn-primary btn-sm'} disabled={out} onClick={onAdd}>
        {added ? <Check size={16} /> : <ShoppingCart size={16} />} {out ? t('Out of stock') : added ? t('Added') : t('Add to cart')}
      </button>
    </div>
  );
}
