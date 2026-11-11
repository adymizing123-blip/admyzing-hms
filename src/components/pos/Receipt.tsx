import { fmtDateTime, money, titleCase } from '@/lib/utils';

export type ReceiptLine = { label: string; value: string; bold?: boolean };

/** Thermal-style receipt used for sales, refunds and shift (Z) reports. */
export default function Receipt({ title, meta, items, totals, footer }: {
  title: string;
  meta: string[];
  items?: { name: string; qty: number; amount: number }[];
  totals: ReceiptLine[];
  footer?: string;
}) {
  return (
    <div className="print-area mx-auto max-w-[300px] font-mono text-xs leading-relaxed">
      <p className="text-center text-sm font-bold">CarePlus Hospital Pharmacy</p>
      <p className="text-center font-semibold">{title}</p>
      {meta.map((m) => <p key={m} className="text-center">{m}</p>)}
      <div className="my-2 border-t border-dashed border-slate-400" />
      {items?.map((l, i) => (
        <div key={i} className="flex justify-between gap-2"><span className="truncate">{l.qty} × {l.name}</span><span>{money(l.amount)}</span></div>
      ))}
      {items && <div className="my-2 border-t border-dashed border-slate-400" />}
      {totals.map((t, i) => (
        <div key={i} className={`flex justify-between ${t.bold ? 'text-sm font-bold' : ''}`}><span>{t.label}</span><span>{t.value}</span></div>
      ))}
      {footer && <p className="mt-3 text-center">{footer}</p>}
    </div>
  );
}

export const paymentLines = (payments: { method: string; amount: number; reference?: string | null }[]) =>
  payments.map((p) => ({ label: `${titleCase(p.method === 'bill' ? 'patient bill' : p.method)}${p.reference ? ` (${p.reference.startsWith('pi_') ? 'reader' : p.reference})` : ''}`, value: money(p.amount) }));

export const now = () => fmtDateTime(new Date());
