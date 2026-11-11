import { cn, titleCase } from '@/lib/utils';

/** Colour-coded labels for chat channels and lead sources, used in Chats, CRM, Patients and the dashboard. */
export const CHANNEL_META: Record<string, { label: string; short: string; dot: string; soft: string }> = {
  whatsapp: { label: 'WhatsApp', short: 'WA', dot: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  facebook: { label: 'Facebook', short: 'FB', dot: 'bg-blue-600', soft: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
  instagram: { label: 'Instagram', short: 'IG', dot: 'bg-pink-600', soft: 'bg-pink-50 text-pink-700 ring-pink-600/20' },
  sms: { label: 'SMS', short: 'SMS', dot: 'bg-slate-500', soft: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
  website: { label: 'Website', short: 'WEB', dot: 'bg-brand-600', soft: 'bg-brand-50 text-brand-700 ring-brand-600/20' },
  google: { label: 'Google', short: 'G', dot: 'bg-amber-500', soft: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  phone: { label: 'Phone call', short: 'TEL', dot: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
  walk_in: { label: 'Walk-in', short: 'WALK', dot: 'bg-teal-600', soft: 'bg-teal-50 text-teal-700 ring-teal-600/20' },
  referral: { label: 'Referral', short: 'REF', dot: 'bg-orange-500', soft: 'bg-orange-50 text-orange-700 ring-orange-600/20' },
  other: { label: 'Other', short: '?', dot: 'bg-slate-400', soft: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
  unknown: { label: 'Unknown', short: '?', dot: 'bg-slate-300', soft: 'bg-slate-100 text-slate-500 ring-slate-500/20' },
};

export const sourceMeta = (s?: string | null) => CHANNEL_META[s || 'unknown'] || { ...CHANNEL_META.other, label: titleCase(s) };

/** Small square with the channel's short name (WA, FB, IG ...). */
export function ChannelDot({ channel, className }: { channel?: string | null; className?: string }) {
  const m = sourceMeta(channel);
  return <span className={cn('inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-md px-1 text-[9px] font-extrabold tracking-wide text-white', m.dot, className)} title={m.label}>{m.short}</span>;
}

export function SourceBadge({ source, detail }: { source?: string | null; detail?: string | null }) {
  const m = sourceMeta(source);
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', m.soft)} title={detail || undefined}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', m.dot)} />
      <span className="truncate">{m.label}{detail ? ` · ${detail}` : ''}</span>
    </span>
  );
}

export const SOURCE_OPTIONS = ['website', 'facebook', 'instagram', 'whatsapp', 'google', 'phone', 'walk_in', 'referral', 'other']
  .map((v) => ({ value: v, label: CHANNEL_META[v].label }));
