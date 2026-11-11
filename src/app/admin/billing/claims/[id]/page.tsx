'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Printer, Download, Send, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner, StatusBadge } from '@/components/ui';
import { buildClaim, claimProblems } from '@/lib/claims';
import { DEFAULT_HOSPITAL } from '@/lib/settings';
import { fmtDate, fmtDateTime, money } from '@/lib/utils';

export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [claim, setClaim] = useState<any>(null);
  const [h, setH] = useState<any>(DEFAULT_HOSPITAL);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('insurance_claims').select('*, invoices(*, patients(*), invoice_items(*))').eq('id', id).single();
    setClaim(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
    supabase.from('settings').select('value').eq('key', 'hospital').maybeSingle().then(({ data }) => data && setH({ ...DEFAULT_HOSPITAL, ...data.value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const c = useMemo(() => (claim ? buildClaim(claim, h) : null), [claim, h]);
  const problems = c ? claimProblems(c) : [];

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' }));
    a.download = `claim-${claim.invoices?.invoice_no}.json`;
    a.click();
  };

  const submit = async () => {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/claims/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim_id: id }) });
    const d = await res.json();
    setBusy(false);
    setMsg(res.ok ? { tone: 'green', text: 'Claim sent to your clearinghouse.' } : { tone: 'red', text: d.error });
    load();
  };

  const setStatus = async (status: string) => {
    const claim_no = status === 'approved' || status === 'paid' ? prompt('Claim / reference number from the insurer (optional)', claim.claim_no || '') : claim.claim_no;
    await supabase.from('insurance_claims').update({ status, claim_no }).eq('id', id);
    if (status === 'paid' && confirm('Record the insurance payment on the invoice now?')) {
      await supabase.from('payments').insert({ invoice_id: claim.invoice_id, amount: Number(claim.amount), method: 'insurance', reference: claim_no || claim.provider });
    }
    load();
  };

  if (!claim || !c) return <div className="flex justify-center py-20"><Spinner /></div>;
  const Box = ({ n, label, children }: { n: string; label: string; children: React.ReactNode }) => (
    <div className="border border-slate-300 p-2"><p className="text-[10px] font-semibold uppercase text-ink-soft">{n}. {label}</p><div className="mt-0.5 text-sm">{children || <span className="text-rose-500">missing</span>}</div></div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/admin/billing" className="no-print text-sm font-semibold text-brand-700">← Billing</Link>

      <div className="no-print card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-xl font-bold">Claim to {claim.provider}</h1><StatusBadge status={claim.status} /></div>
          <p className="text-sm text-ink-soft">Invoice <Link href={`/admin/billing/${claim.invoice_id}`} className="text-brand-700">{claim.invoices?.invoice_no}</Link> · {money(claim.amount)} · created {fmtDate(claim.created_at)}</p>
          <p className="text-xs text-ink-muted">Electronic: {claim.submission_status === 'sent' ? `sent ${fmtDateTime(claim.submitted_at)}` : claim.submission_status === 'failed' ? `failed ${fmtDateTime(claim.submitted_at)}` : 'not sent'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" onClick={() => window.print()}><Printer size={14} /> Print form</button>
          <button className="btn-secondary btn-sm" onClick={download}><Download size={14} /> Download JSON</button>
          <button className="btn-primary btn-sm" disabled={busy || problems.length > 0} onClick={submit}>{busy ? <Spinner /> : <Send size={14} />} Submit electronically</button>
        </div>
      </div>

      {msg && <div className="no-print"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {problems.length > 0 && (
        <div className="no-print rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> Fix these before submitting</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="no-print card flex flex-wrap items-center gap-2 p-4 text-sm">
        <span className="mr-2 font-semibold">Insurer response:</span>
        {['submitted', 'approved', 'denied', 'paid'].map((s) => (
          <button key={s} className={`btn-sm ${claim.status === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
        ))}
      </div>

      <div className="print-area card p-5 sm:p-8">
        <div className="mb-4 flex items-end justify-between border-b-2 border-slate-800 pb-2">
          <p className="text-lg font-extrabold">HEALTH INSURANCE CLAIM</p>
          <p className="text-xs text-ink-soft">CMS-1500 data summary · {c.invoice_number}</p>
        </div>
        <div className="grid grid-cols-1 gap-0 sm:grid-cols-2">
          <Box n="1" label="Insurance / payer">{c.payer.name}{c.payer.payer_id && ` (Payer ID ${c.payer.payer_id})`}</Box>
          <Box n="1a" label="Insured's ID number">{c.subscriber.member_id}</Box>
          <Box n="2" label="Patient name">{c.subscriber.last_name}, {c.subscriber.first_name}</Box>
          <Box n="3" label="Birth date / sex">{c.subscriber.date_of_birth ? `${c.subscriber.date_of_birth} · ${c.subscriber.gender}` : null}</Box>
          <Box n="5" label="Patient address">{[c.subscriber.address.line1, c.subscriber.address.city, c.subscriber.address.state, c.subscriber.address.zip].filter(Boolean).join(', ') || null}</Box>
          <Box n="6" label="Relationship to insured">Self</Box>
          <div className="border border-slate-300 p-2 sm:col-span-2">
            <p className="text-[10px] font-semibold uppercase text-ink-soft">21. Diagnosis (ICD-10)</p>
            <div className="mt-1 flex flex-wrap gap-3 text-sm">{c.diagnosis_codes.length ? c.diagnosis_codes.map((d: string, i: number) => <span key={d}><b>{String.fromCharCode(65 + i)}.</b> {d}</span>) : <span className="text-rose-500">missing</span>}</div>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border border-slate-300 text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase text-ink-soft">
            <tr><th className="border border-slate-300 p-1.5 text-left">24A. Date</th><th className="border border-slate-300 p-1.5">B. POS</th><th className="border border-slate-300 p-1.5 text-left">D. CPT/HCPCS</th><th className="border border-slate-300 p-1.5 text-left">Description</th><th className="border border-slate-300 p-1.5">E. Dx ptr</th><th className="border border-slate-300 p-1.5 text-right">F. Charges</th><th className="border border-slate-300 p-1.5">G. Units</th></tr>
          </thead>
          <tbody>
            {c.service_lines.map((l: any) => (
              <tr key={l.line}>
                <td className="border border-slate-300 p-1.5">{l.service_date}</td>
                <td className="border border-slate-300 p-1.5 text-center">{l.place_of_service}</td>
                <td className="border border-slate-300 p-1.5 font-mono">{l.procedure_code || <span className="text-rose-500">missing</span>}</td>
                <td className="border border-slate-300 p-1.5">{l.description}</td>
                <td className="border border-slate-300 p-1.5 text-center">{l.diagnosis_pointers.length ? 'A' : '-'}</td>
                <td className="border border-slate-300 p-1.5 text-right">{money(l.charge)}</td>
                <td className="border border-slate-300 p-1.5 text-center">{l.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="mt-0 grid grid-cols-1 sm:grid-cols-3">
          <Box n="25" label="Federal tax ID">{c.billing_provider.tax_id}</Box>
          <Box n="28" label="Total charge">{money(c.total_charge)}</Box>
          <Box n="33a" label="Billing provider NPI">{c.billing_provider.npi}</Box>
          <div className="border border-slate-300 p-2 sm:col-span-3">
            <p className="text-[10px] font-semibold uppercase text-ink-soft">33. Billing provider</p>
            <p className="mt-0.5 text-sm">{c.billing_provider.name} · {c.billing_provider.address} · {c.billing_provider.phone}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
