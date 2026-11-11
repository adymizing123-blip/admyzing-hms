import { cn } from '@/lib/utils';

export function StatCard({
  label, value, icon, hint, tone = 'brand',
}: { label: string; value: React.ReactNode; icon?: React.ReactNode; hint?: string; tone?: 'brand' | 'sky' | 'amber' | 'rose' | 'violet' }) {
  const t = {
    brand: 'bg-brand-50 text-brand-700', sky: 'bg-sky-50 text-sky-700', amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700', violet: 'bg-violet-50 text-violet-700',
  }[tone];
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
          <p className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
          {hint && <p className="mt-1 truncate text-xs text-ink-muted">{hint}</p>}
        </div>
        {icon && <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', t)}>{icon}</div>}
      </div>
    </div>
  );
}
