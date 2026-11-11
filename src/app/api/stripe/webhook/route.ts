import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) return NextResponse.json({ error: 'Stripe not configured' }, { status: 400 });

  const stripe = new Stripe(key);
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, req.headers.get('stripe-signature')!, secret);
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid signature: ${e.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    const db = createAdminClient();
    if (s.payment_status === 'paid' && s.metadata?.kind === 'invoice' && s.metadata.invoice_id) {
      // patient paid a hospital bill online (idempotent: Stripe may retry webhooks)
      const { data: exists } = await db.from('payments').select('id').eq('reference', s.id).maybeSingle();
      if (!exists) await db.from('payments').insert({ invoice_id: s.metadata.invoice_id, amount: (s.amount_total || 0) / 100, method: 'stripe', reference: s.id });
    } else if (s.metadata?.order_id && s.payment_status === 'paid') {
      await db.rpc('mark_order_paid', { p_order: s.metadata.order_id, p_session: s.id });
    }
  }
  return NextResponse.json({ received: true });
}
