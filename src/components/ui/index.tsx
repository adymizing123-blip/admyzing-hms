'use client';
import { X, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { cn, titleCase } from '@/lib/utils';

export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={cn('max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-soft hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const tones: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};

const statusTone: Record<string, keyof typeof tones> = {
  booked: 'blue', checked_in: 'amber', in_consultation: 'violet', completed: 'green', cancelled: 'gray', no_show: 'red',
  available: 'green', occupied: 'red', cleaning: 'amber', maintenance: 'gray',
  draft: 'gray', unpaid: 'red', partial: 'amber', paid: 'green', void: 'gray',
  ordered: 'blue', collected: 'amber', processing: 'violet',
  pending: 'amber', shipped: 'blue', delivered: 'green',
  new: 'blue', contacted: 'amber', qualified: 'violet', converted: 'green', lost: 'gray',
  admitted: 'red', discharged: 'green', scheduled: 'blue', in_progress: 'violet',
  submitted: 'blue', approved: 'green', denied: 'red', done: 'green', skipped: 'gray',
  present: 'green', absent: 'red', leave: 'amber', half_day: 'amber', open: 'amber', resolved: 'green',
  sent: 'green', received: 'green',
};

export function Badge({ children, tone }: { children: React.ReactNode; tone?: keyof typeof tones }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone || 'gray'])}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return <Badge tone={statusTone[status] || 'gray'}>{titleCase(status)}</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin', className)} size={18} />;
}

export function Empty({ text = 'Nothing here yet.' }: { text?: string }) {
  return <div className="px-4 py-12 text-center text-sm text-ink-muted">{text}</div>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={cn('whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition',
              value === t.id ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Alert({ children, tone = 'red' }: { children: React.ReactNode; tone?: 'red' | 'green' | 'amber' }) {
  const c = { red: 'bg-rose-50 text-rose-700 border-rose-200', green: 'bg-emerald-50 text-emerald-700 border-emerald-200', amber: 'bg-amber-50 text-amber-800 border-amber-200' }[tone];
  return <div className={cn('rounded-xl border px-4 py-3 text-sm', c)}>{children}</div>;
}
