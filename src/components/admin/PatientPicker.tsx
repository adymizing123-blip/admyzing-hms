'use client';
import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fullName } from '@/lib/utils';

export type PickedPatient = { id: string; first_name: string; last_name: string; mrn: string; phone?: string; insurance_provider?: string; insurance_member_id?: string };

/** Search patients by name, MRN, phone or email. Shared by OPD, IPD, POS, lab and billing. */
export default function PatientPicker({ value, onChange, placeholder = 'Search patient by name, MRN or phone' }: {
  value: PickedPatient | null; onChange: (p: PickedPatient | null) => void; placeholder?: string;
}) {
  const supabase = createClient();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedPatient[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(async () => {
      const term = q.replace(/[%,()]/g, ' ').trim();
      const { data } = await supabase
        .from('patients')
        .select('id, first_name, last_name, mrn, phone, insurance_provider, insurance_member_id')
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,mrn.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(8);
      setResults(data || []);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{fullName(value)}</p>
          <p className="text-xs text-ink-soft">{value.mrn}{value.phone ? ` · ${value.phone}` : ''}</p>
        </div>
        <button type="button" className="rounded-lg p-1 text-ink-soft hover:bg-white" onClick={() => onChange(null)} aria-label="Clear"><X size={16} /></button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-3 text-ink-muted" />
      <input className="input pl-9" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)} />
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {results.map((p) => (
            <button type="button" key={p.id} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => { onChange(p); setQ(''); setOpen(false); }}>
              <p className="text-sm font-semibold">{fullName(p)}</p>
              <p className="text-xs text-ink-soft">{p.mrn}{p.phone ? ` · ${p.phone}` : ''}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
