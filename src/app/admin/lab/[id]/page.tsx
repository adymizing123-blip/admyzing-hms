'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Printer, Upload } from 'lucide-react';
import { Modal } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { StatusBadge, Alert, Spinner } from '@/components/ui';
import { age, fmtDateTime, fullName, money } from '@/lib/utils';

export default function LabOrder() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [o, setO] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [imp, setImp] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('lab_orders').select('*, patients(*), doctors(full_name), lab_order_items(*, lab_tests(*))').eq('id', id).single();
    setO(data);
    setItems(data?.lab_order_items || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (status: string) => {
    await supabase.from('lab_orders').update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null }).eq('id', id);
    load();
  };

  const saveResults = async (complete: boolean) => {
    setBusy(true);
    for (const i of items) {
      await supabase.from('lab_order_items').update({ result: i.result || null, flag: i.flag || null }).eq('id', i.id);
    }
    if (complete) await setStatus('completed');
    setBusy(false);
    setMsg(complete ? 'Results published. The patient can now see them in the portal.' : 'Results saved.');
    load();
  };

  const bill = async () => {
    const { data, error } = await supabase.rpc('bill_lab_order', { p_order: id });
    if (error) return alert(error.message);
    router.push(`/admin/billing/${data}`);
  };

  if (!o) return <div className="flex justify-center py-20"><Spinner /></div>;
  const p = o.patients;
  const editable = o.status !== 'completed' && o.status !== 'cancelled';

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/admin/lab" className="no-print text-sm font-semibold text-brand-700">← Lab orders</Link>
      <div className="no-print card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-xl font-bold">{o.order_no}</h1><StatusBadge status={o.status} /></div>
          <p className="text-sm text-ink-soft">{fullName(p)} · {p.mrn} · ordered {fmtDateTime(o.ordered_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.status === 'ordered' && <button className="btn-secondary btn-sm" onClick={() => setStatus('collected')}>Sample collected</button>}
          {o.status === 'collected' && <button className="btn-secondary btn-sm" onClick={() => setStatus('processing')}>Start processing</button>}
          {o.status !== 'completed' && <button className="btn-secondary btn-sm" onClick={() => setImp('')}><Upload size={14} /> Import results</button>}
          <button className="btn-secondary btn-sm" onClick={bill}>Create bill</button>
          {o.status === 'completed' && <button className="btn-primary btn-sm" onClick={() => window.print()}><Printer size={14} /> Print report</button>}
        </div>
      </div>

      {msg && <div className="no-print"><Alert tone={msg.startsWith('Import failed') ? 'red' : 'green'}>{msg}</Alert></div>}

      <Modal open={imp !== null} onClose={() => setImp(null)} title="Import results from analyzer" wide>
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">Paste an HL7 ORU message or CSV (<code>order_no,test_code,result,flag</code>), or choose the exported file. Results are matched by order number {o.order_no} and test code.</p>
          <input type="file" accept=".hl7,.txt,.csv" className="text-sm" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setImp(await file.text()); }} />
          <textarea className="input min-h-[180px] font-mono text-xs" value={imp || ''} onChange={(e) => setImp(e.target.value)} placeholder={`MSH|^~\\&|ANALYZER|LAB|CAREPLUS|HOSP|20261109||ORU^R01|1|P|2.5\nPID|1||${p.mrn}\nOBR|1|${o.order_no}\nOBX|1|NM|CBC^Complete Blood Count||7.2|10^3/uL|4-11|N|||F`} />
          <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setImp(null)}>Cancel</button>
            <button className="btn-primary" disabled={!imp?.trim() || busy} onClick={async () => {
              setBusy(true);
              const res = await fetch('/api/lab/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: imp }) });
              const d = await res.json();
              setBusy(false); setImp(null);
              setMsg(res.ok ? d.report.map((r: any) => `${r.orderNo}: ${r.error || `${r.matched} result(s) imported${r.unmatched.length ? `, not matched: ${r.unmatched.join(', ')}` : ''}${r.completed ? ', order completed' : ''}`}`).join(' · ') : `Import failed: ${d.error}`);
              load();
            }}>{busy && <Spinner />} Import</button></div>
        </div>
      </Modal>

      <div className="print-area card p-5 sm:p-8">
        <div className="hidden border-b border-slate-200 pb-4 print:block">
          <p className="text-xl font-extrabold text-brand-700">CarePlus Hospital · Laboratory Report</p>
          <p className="text-sm">{fullName(p)} · {p.mrn} · {age(p.dob)} {p.gender || ''} · Ref: {o.doctors?.full_name || 'Self'} · {o.order_no}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead><tr><th className="th">Test</th><th className="th">Result</th><th className="th">Unit</th><th className="th">Normal range</th><th className="th">Flag</th><th className="th no-print">Price</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i, idx) => (
                <tr key={i.id}>
                  <td className="td font-medium">{i.lab_tests?.name}</td>
                  <td className="td">
                    {editable ? <input className="input min-w-[120px] py-1.5" value={i.result || ''} onChange={(e) => { const n = [...items]; n[idx] = { ...i, result: e.target.value }; setItems(n); }} />
                      : <span className={i.flag && i.flag !== 'normal' ? 'font-bold text-rose-600' : ''}>{i.result || '-'}</span>}
                  </td>
                  <td className="td text-ink-soft">{i.lab_tests?.unit}</td>
                  <td className="td text-ink-soft">{i.lab_tests?.normal_range}</td>
                  <td className="td">
                    {editable ? (
                      <select className="input py-1.5" value={i.flag || ''} onChange={(e) => { const n = [...items]; n[idx] = { ...i, flag: e.target.value }; setItems(n); }}>
                        <option value="">-</option><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option><option value="critical">Critical</option>
                      </select>
                    ) : <span className="capitalize">{i.flag || '-'}</span>}
                  </td>
                  <td className="td no-print">{money(i.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="no-print mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className="btn-secondary" disabled={busy} onClick={() => saveResults(false)}>Save draft</button>
            <button className="btn-primary" disabled={busy} onClick={() => saveResults(true)}>{busy && <Spinner />} Publish results</button>
          </div>
        )}
      </div>
    </div>
  );
}
