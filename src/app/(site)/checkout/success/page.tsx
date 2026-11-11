import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { getT } from '@/lib/i18n-server';

export default function Success({ searchParams }: { searchParams: { order?: string; pickup?: string } }) {
  const t = getT();
  return (
    <div className="container-x py-20 text-center">
      <CheckCircle2 size={60} className="mx-auto text-brand-600" />
      <h1 className="mt-4 text-3xl font-extrabold">{t('Thank you for your order!')}</h1>
      {searchParams.order && <p className="mt-2 text-ink-soft">{t('Order')} <span className="font-semibold text-ink">{searchParams.order}</span></p>}
      <p className="mt-2 text-ink-soft">
        {t(searchParams.pickup ? 'Online payment is not set up yet, so you can pay when the order is delivered or picked up.' : 'A confirmation email is on its way.')}
      </p>
      <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
        <Link href="/store" className="btn-secondary">{t('Continue shopping')}</Link>
        <Link href="/portal" className="btn-primary">{t('View my orders')}</Link>
      </div>
    </div>
  );
}
