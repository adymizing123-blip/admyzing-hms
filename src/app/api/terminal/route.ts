import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requireRole } from '@/lib/staff-auth';

/**
 * Stripe Terminal (card reader) for the pharmacy POS, server-driven integration.
 * Env: STRIPE_SECRET_KEY, STRIPE_TERMINAL_READER_ID (e.g. tmr_...).
 *
 * GET                       -> { enabled, simulated }
 * GET  ?pi=pi_...           -> { status, last4 }   poll a payment
 * POST { action: 'charge', amount, description } -> { payment_intent }
 * POST { action: 'cancel' }                      -> cancels the reader screen
 * POST { action: 'simulate' }                    -> test mode only: taps a test card on a simulated reader
 * POST { action: 'refund', payment_intent, amount } -> { refund }
 */
const ROLES = ['pharmacist', 'receptionist'] as const;

function config() {
  const key = process.env.STRIPE_SECRET_KEY;
  const reader = process.env.STRIPE_TERMINAL_READER_ID;
  return { key, reader, enabled: !!(key && reader), test: !!key?.startsWith('sk_test') };
}

export async function GET(req: Request) {
  if (!(await requireRole([...ROLES]))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const c = config();
  const pi = new URL(req.url).searchParams.get('pi');
  if (!pi) return NextResponse.json({ enabled: c.enabled, simulated: c.test });
  if (!c.enabled) return NextResponse.json({ error: 'Card reader is not configured' }, { status: 400 });
  const stripe = new Stripe(c.key!);
  const intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] });
  const charge = intent.latest_charge as Stripe.Charge | null;
  let readerError: string | null = null;
  if (intent.status === 'requires_payment_method') {
    const reader = await stripe.terminal.readers.retrieve(c.reader!);
    const action = (reader as Stripe.Terminal.Reader).action;
    if (action?.status === 'failed') readerError = action.failure_message || 'Card was declined';
  }
  return NextResponse.json({
    status: intent.status,
    last4: charge?.payment_method_details?.card_present?.last4 || null,
    error: readerError,
  });
}

export async function POST(req: Request) {
  if (!(await requireRole([...ROLES]))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const c = config();
  if (!c.enabled) return NextResponse.json({ error: 'Card reader is not configured. Add STRIPE_SECRET_KEY and STRIPE_TERMINAL_READER_ID.' }, { status: 400 });
  const stripe = new Stripe(c.key!);
  const body = await req.json();
  try {
    switch (body.action) {
      case 'charge': {
        const cents = Math.round(Number(body.amount) * 100);
        if (!(cents > 0)) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        const intent = await stripe.paymentIntents.create({
          amount: cents, currency: 'usd', payment_method_types: ['card_present'], capture_method: 'automatic',
          description: body.description || 'Pharmacy sale',
        });
        await stripe.terminal.readers.processPaymentIntent(c.reader!, { payment_intent: intent.id });
        return NextResponse.json({ payment_intent: intent.id });
      }
      case 'cancel': {
        await stripe.terminal.readers.cancelAction(c.reader!);
        return NextResponse.json({ ok: true });
      }
      case 'simulate': {
        if (!c.test) return NextResponse.json({ error: 'Simulation only works with test keys' }, { status: 400 });
        await stripe.testHelpers.terminal.readers.presentPaymentMethod(c.reader!);
        return NextResponse.json({ ok: true });
      }
      case 'refund': {
        const refund = await stripe.refunds.create({ payment_intent: body.payment_intent, amount: Math.round(Number(body.amount) * 100) });
        return NextResponse.json({ refund: refund.id });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
