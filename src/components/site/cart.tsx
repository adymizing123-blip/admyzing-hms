'use client';
import { createContext, useContext, useEffect, useState } from 'react';

export type CartItem = { id: string; name: string; price: number; image_url?: string; quantity: number };

type Ctx = {
  items: CartItem[];
  add: (item: Omit<CartItem, 'quantity'>, qty?: number) => void;
  update: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  count: number;
  subtotal: number;
};

const CartCtx = createContext<Ctx | null>(null);
const KEY = 'careplus_cart';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
  }, []);

  const persist = (next: CartItem[]) => {
    setItems(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  };

  const value: Ctx = {
    items,
    add: (item, qty = 1) => {
      const found = items.find((i) => i.id === item.id);
      persist(found ? items.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + qty } : i)) : [...items, { ...item, quantity: qty }]);
    },
    update: (id, qty) => persist(qty <= 0 ? items.filter((i) => i.id !== id) : items.map((i) => (i.id === id ? { ...i, quantity: qty } : i))),
    remove: (id) => persist(items.filter((i) => i.id !== id)),
    clear: () => persist([]),
    count: items.reduce((s, i) => s + i.quantity, 0),
    subtotal: items.reduce((s, i) => s + i.quantity * Number(i.price), 0),
  };

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export const useCart = () => {
  const c = useContext(CartCtx);
  if (!c) throw new Error('useCart must be inside CartProvider');
  return c;
};
