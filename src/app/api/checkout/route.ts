import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { SHIPPING_FLAT, SHIPPING_FREE_OVER, STORE_TAX_RATE } from '@/lib/store';

export async function POST(req: Request) {
  try {
    const { items, customer } = await req.json();
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    if (!customer?.customer_name || !customer?.email) return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });

    const admin = createAdminClient();

    // Prices always come from the database, never from the browser
    const ids = items.map((i: any) => i.id);
    const { data: products, error } = await admin.from('products').select('*').in('id', ids).eq('active', true);
    if (error) throw error;

    const lines = items.map((i: any) => {
      const p = products!.find((x) => x.id === i.id);
      if (!p) throw new Error('A product in your cart is no longer available');
      const qty = Math.max(1, Math.floor(Number(i.quantity) || 1));
      if (p.stock < qty) throw new Error(`Only ${p.stock} left of ${p.name}`);
      return { p, qty };
    });

    const subtotal = lines.reduce((s: number, l: any) => s + l.qty * Number(l.p.price), 0);
    const shipping = subtotal >= SHIPPING_FREE_OVER ? 0 : SHIPPING_FLAT;
    const tax = Math.round(subtotal * STORE_TAX_RATE) / 100;
    const total = Math.round((subtotal + shipping + tax) * 100) / 100;

    // link to logged-in patient if any
    const { data: { user } } = await createClient().auth.getUser();
    let patient_id: string | null = null;
    if (user) {
      const { data: pt } = await admin.from('patients').select('id').eq('profile_id', user.id).maybeSingle();
      patient_id = pt?.id ?? null;
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const address = [customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ');

    const { data: order, error: oErr } = await admin.from('orders').insert({
      patient_id, customer_name: customer.customer_name, email: customer.email, phone: customer.phone,
      shipping_address: address, subtotal, shipping, tax, total,
      payment_method: stripeKey ? 'stripe' : 'pay_on_delivery',
    }).select().single();
    if (oErr) throw oErr;

    await admin.from('order_items').insert(lines.map((l: any) => ({
      order_id: order.id, product_id: l.p.id, name: l.p.name, quantity: l.qty, unit_price: l.p.price,
    })));

    const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

    if (!stripeKey) {
      return NextResponse.json({ url: `${site}/checkout/success?order=${order.order_no}&pickup=1` });
    }

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customer.email,
      line_items: [
        ...lines.map((l: any) => ({
          quantity: l.qty,
          price_data: { currency: 'usd', unit_amount: Math.round(Number(l.p.price) * 100), product_data: { name: l.p.name } },
        })),
        ...(shipping ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(shipping * 100), product_data: { name: 'Shipping' } } }] : []),
        ...(tax ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(tax * 100), product_data: { name: 'Sales tax' } } }] : []),
      ],
      metadata: { order_id: order.id },
      success_url: `${site}/checkout/success?order=${order.order_no}`,
      cancel_url: `${site}/cart`,
    });

    await admin.from('orders').update({ stripe_session_id: session.id }).eq('id', order.id);
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Checkout failed' }, { status: 400 });
  }
}
