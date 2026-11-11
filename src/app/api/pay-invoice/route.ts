import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

/** Patient pays the balance of one of their own invoices with Stripe Checkout. */
export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return NextResponse.json({ error: 'Online payment is not available yet. Please pay at the hospital or call billing.' }, { status: 400 });
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
  const { invoice_id } = await req.json();
  // RLS only returns the invoice if it belongs to this patient
  const { data: inv } = await supabase.from('invoices').select('id, invoice_no, total, amount_paid, status, patients(email)').eq('id', invoice_id).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  const balance = Math.round((Number(inv.total) - Number(inv.amount_paid)) * 100);
  if (balance <= 0 || !['unpaid', 'partial'].includes(inv.status)) return NextResponse.json({ error: 'Nothing to pay on this invoice' }, { status: 400 });

  const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  const session = await new Stripe(key).checkout.sessions.create({
    mode: 'payment',
    customer_email: (inv as any).patients?.email || user.email,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: balance, product_data: { name: `Hospital bill ${inv.invoice_no}` } } }],
    metadata: { kind: 'invoice', invoice_id: inv.id },
    success_url: `${site}/portal?paid=${inv.invoice_no}`,
    cancel_url: `${site}/portal`,
  });
  return NextResponse.json({ url: session.url });
}
