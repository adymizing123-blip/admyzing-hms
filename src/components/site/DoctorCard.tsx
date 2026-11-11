import Link from 'next/link';
import { money } from '@/lib/utils';
import { getT } from '@/lib/i18n-server';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function DoctorCard({ d }: { d: any }) {
  const t = getT();
  return (
    <div className="card group flex flex-col overflow-hidden">
      <div className="aspect-[4/3] overflow-hidden bg-brand-50">
        {d.photo_url ? (
          <img src={d.photo_url} alt={d.full_name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          <div className="grid h-full place-items-center text-4xl font-bold text-brand-300">{d.full_name.split(' ').slice(-1)[0][0]}</div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{d.departments?.name}</p>
        <h3 className="mt-1 text-lg font-bold">{d.full_name}</h3>
        <p className="text-sm text-ink-soft">{d.specialty}{d.qualification ? ` · ${d.qualification}` : ''}</p>
        <p className="mt-3 text-xs text-ink-muted">{(d.available_days || []).map((x: number) => DAYS[x]).join(', ')} · {String(d.start_time).slice(0, 5)} to {String(d.end_time).slice(0, 5)}</p>
        <div className="mt-auto flex items-center justify-between pt-4">
          <span className="text-sm font-semibold">{money(d.consultation_fee)} <span className="font-normal text-ink-muted">{t('/ visit')}</span></span>
          <Link href={`/book?doctor=${d.id}`} className="btn-primary btn-sm">{t('Book')}</Link>
        </div>
      </div>
    </div>
  );
}
