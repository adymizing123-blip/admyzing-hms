'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { Download, Upload, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, Alert, Spinner, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

type Col = { key: string; label: string; required?: boolean; type?: 'number' | 'date' | 'bool' | 'gender' | 'role' };
type Kind = { id: string; label: string; table: string; cols: Col[]; sample: Record<string, string>; conflict?: string };

const KINDS: Kind[] = [
  {
    id: 'patients', label: 'Patients', table: 'patients',
    cols: [
      { key: 'first_name', label: 'First name', required: true }, { key: 'last_name', label: 'Last name', required: true },
      { key: 'dob', label: 'Date of birth (YYYY-MM-DD)', type: 'date' }, { key: 'gender', label: 'Gender (male/female/other)', type: 'gender' },
      { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' },
      { key: 'state', label: 'State' }, { key: 'zip', label: 'ZIP' }, { key: 'blood_group', label: 'Blood group' }, { key: 'allergies', label: 'Allergies' },
      { key: 'insurance_provider', label: 'Insurance' }, { key: 'insurance_member_id', label: 'Member ID' },
    ],
    sample: { first_name: 'Jane', last_name: 'Doe', dob: '1985-02-14', gender: 'female', phone: '(512) 555-0100', email: 'jane@example.com', city: 'Austin', state: 'TX', zip: '78701', blood_group: 'A+', allergies: 'Penicillin', insurance_provider: 'Aetna', insurance_member_id: 'AET-1' },
  },
  {
    id: 'medicines', label: 'Medicines + opening stock', table: 'medicines', conflict: 'sku',
    cols: [
      { key: 'name', label: 'Brand name', required: true }, { key: 'generic_name', label: 'Generic' }, { key: 'category', label: 'Category' },
      { key: 'form', label: 'Form' }, { key: 'strength', label: 'Strength' }, { key: 'sku', label: 'SKU', required: true }, { key: 'barcode', label: 'Barcode' },
      { key: 'price', label: 'Price', type: 'number', required: true }, { key: 'cost', label: 'Cost', type: 'number' }, { key: 'reorder_level', label: 'Reorder level', type: 'number' },
      { key: 'requires_prescription', label: 'Rx (yes/no)', type: 'bool' },
      { key: 'opening_stock', label: 'Opening stock qty', type: 'number' }, { key: 'batch_no', label: 'Batch no.' }, { key: 'expiry_date', label: 'Expiry (YYYY-MM-DD)', type: 'date' },
    ],
    sample: { name: 'Tylenol', generic_name: 'Acetaminophen', category: 'Pain Relief', form: 'Tablet', strength: '500 mg', sku: 'MED-100', barcode: '0300450449', price: '0.25', cost: '0.08', reorder_level: '200', requires_prescription: 'no', opening_stock: '500', batch_no: 'B100', expiry_date: '2028-01-31' },
  },
  {
    id: 'inventory', label: 'Inventory items', table: 'inventory_items',
    cols: [
      { key: 'name', label: 'Name', required: true }, { key: 'category', label: 'Category (consumable/surgical/equipment/linen)' }, { key: 'unit', label: 'Unit' },
      { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'reorder_level', label: 'Reorder level', type: 'number' }, { key: 'location', label: 'Location' }, { key: 'unit_price', label: 'Charge per unit', type: 'number' },
    ],
    sample: { name: 'Surgical gloves (box)', category: 'consumable', unit: 'box', quantity: '100', reorder_level: '20', location: 'Central store', unit_price: '12' },
  },
  {
    id: 'staff', label: 'Staff', table: 'staff',
    cols: [
      { key: 'full_name', label: 'Full name', required: true }, { key: 'role', label: 'Role (doctor/nurse/receptionist/pharmacist/lab_tech/accountant/admin)', required: true, type: 'role' },
      { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'hire_date', label: 'Hire date', type: 'date' },
      { key: 'pay_type', label: 'Pay type (salary/hourly)' }, { key: 'base_salary', label: 'Monthly salary', type: 'number' }, { key: 'hourly_rate', label: 'Hourly rate', type: 'number' },
    ],
    sample: { full_name: 'Sam Lee', role: 'nurse', phone: '(512) 555-0101', email: 'sam@example.com', hire_date: '2024-05-01', pay_type: 'hourly', base_salary: '0', hourly_rate: '40' },
  },
  {
    id: 'suppliers', label: 'Suppliers', table: 'suppliers',
    cols: [{ key: 'name', label: 'Company', required: true }, { key: 'contact_person', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address' }],
    sample: { name: 'Medline', contact_person: 'Ann Price', phone: '(800) 555-0199', email: 'orders@medline.example', address: 'Northfield, IL' },
  },
];

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_tech', 'accountant'];
const norm = (h: string) => h.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function clean(kind: Kind, raw: Record<string, any>) {
  const row: Record<string, any> = {}; const errors: string[] = [];
  for (const c of kind.cols) {
    let v = raw[c.key];
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    v = v === undefined || v === null ? '' : String(v).trim();
    if (!v) { if (c.required) errors.push(`${c.label} is required`); row[c.key] = null; continue; }
    if (c.type === 'number') { const n = Number(v.replace(/[$,]/g, '')); if (isNaN(n)) errors.push(`${c.label} must be a number`); row[c.key] = n; }
    else if (c.type === 'date') {
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // US format MM/DD/YYYY
      const iso = m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : v;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || isNaN(Date.parse(iso))) errors.push(`${c.label} must be a date`);
      row[c.key] = iso;
    } else if (c.type === 'bool') row[c.key] = /^(y|yes|true|1|x)$/i.test(v);
    else if (c.type === 'gender') { const g = v.toLowerCase()[0]; row[c.key] = g === 'm' ? 'male' : g === 'f' ? 'female' : 'other'; }
    else if (c.type === 'role') { const r = v.toLowerCase().replace(/\s+/g, '_'); if (!ROLES.includes(r)) errors.push(`Unknown role "${v}"`); row[c.key] = r; }
    else row[c.key] = v;
  }
  return { row, errors };
}

export default function ImportPage() {
  const supabase = createClient();
  const [kind, setKind] = useState<Kind>(KINDS[0]);
  const [rows, setRows] = useState<{ row: any; errors: string[] }[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: number; failed: number; messages: string[] } | null>(null);
  const [err, setErr] = useState('');

  const template = () => {
    const csv = Papa.unparse({ fields: kind.cols.map((c) => c.key), data: [kind.cols.map((c) => kind.sample[c.key] || '')] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `careplus-${kind.id}-template.csv`;
    a.click();
  };

  const load = async (file: File) => {
    setErr(''); setResult(null); setFileName(file.name);
    let objects: Record<string, any>[] = [];
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const readXlsxFile = (await import('read-excel-file')).default;
        const sheet = await readXlsxFile(file);
        const head = (sheet[0] || []).map((h: any) => norm(String(h ?? '')));
        objects = sheet.slice(1).map((r: any[]) => Object.fromEntries(head.map((h: string, i: number) => [h, r[i]])));
      } else {
        const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: norm });
        objects = parsed.data;
      }
    } catch (e: any) { return setErr(`Could not read the file: ${e.message}`); }
    const keys = kind.cols.map((c) => c.key);
    const unknown = Object.keys(objects[0] || {}).filter((k) => k && !keys.includes(k));
    if (!objects.length) return setErr('The file has no rows.');
    if (kind.cols.filter((c) => c.required).some((c) => !(c.key in (objects[0] || {})))) return setErr(`Missing required columns. Download the template to see the expected headers.`);
    if (unknown.length) setErr(`These columns will be ignored: ${unknown.join(', ')}`);
    setRows(objects.filter((o) => Object.values(o).some((v) => v !== '' && v != null)).map((o) => clean(kind, o)));
  };

  const run = async () => {
    setBusy(true); setProgress(0);
    const good = rows.filter((r) => !r.errors.length).map((r) => r.row);
    let ok = 0, failed = 0; const messages: string[] = [];
    for (let i = 0; i < good.length; i += 200) {
      const chunk = good.slice(i, i + 200);
      if (kind.id === 'medicines') {
        const meds = chunk.map(({ opening_stock, batch_no, expiry_date, ...m }) => ({ ...m, active: true, requires_prescription: !!m.requires_prescription, reorder_level: m.reorder_level ?? 20, cost: m.cost ?? 0 }));
        const { data, error } = await supabase.from('medicines').upsert(meds, { onConflict: 'sku' }).select('id, sku');
        if (error) { failed += chunk.length; messages.push(error.message); continue; }
        ok += data.length;
        const batches = chunk.filter((r) => Number(r.opening_stock) > 0).map((r) => ({
          medicine_id: data.find((d: any) => d.sku === r.sku)?.id, batch_no: r.batch_no || `OPEN-${r.sku}`, quantity: r.opening_stock,
          expiry_date: r.expiry_date || new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10), cost: r.cost ?? 0,
        })).filter((b) => b.medicine_id);
        if (batches.length) { const { error: be } = await supabase.from('medicine_batches').insert(batches); if (be) messages.push(`Stock: ${be.message}`); }
      } else {
        const payload = kind.id === 'staff' ? chunk.map((r) => ({ ...r, pay_type: r.pay_type === 'hourly' ? 'hourly' : 'salary', active: true })) : chunk;
        const { error } = await supabase.from(kind.table).insert(payload);
        if (error) { failed += chunk.length; messages.push(error.message); } else ok += chunk.length;
      }
      setProgress(Math.round(((i + chunk.length) / good.length) * 100));
    }
    setBusy(false);
    setResult({ ok, failed: failed + rows.filter((r) => r.errors.length).length, messages });
    if (!failed) setRows([]);
  };

  const bad = rows.filter((r) => r.errors.length).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Data import" subtitle="Bring records over from your old system with a CSV or Excel (.xlsx) file." />
      <div className="mb-5 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => { setKind(k); setRows([]); setResult(null); setErr(''); setFileName(''); }}
            className={cn('rounded-xl px-4 py-2 text-sm font-semibold ring-1', kind.id === k.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white ring-slate-200')}>{k.label}</button>
        ))}
      </div>

      <div className="card space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-bold">1. Download the template</p>
            <p className="text-sm text-ink-soft">Columns: {kind.cols.map((c) => `${c.key}${c.required ? '*' : ''}`).join(', ')}</p>
          </div>
          <button className="btn-secondary" onClick={template}><Download size={16} /> Template (CSV)</button>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-bold">2. Upload your file</p><p className="text-sm text-ink-soft">CSV or .xlsx, first row = column names. Dates as YYYY-MM-DD or MM/DD/YYYY.</p></div>
          <label className="btn-primary cursor-pointer"><Upload size={16} /> {fileName || 'Choose file'}<input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
        </div>
        {err && <Alert tone="amber">{err}</Alert>}
        {result && (
          <Alert tone={result.failed ? 'amber' : 'green'}>
            <span className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} /> Imported {result.ok} row(s){result.failed ? `, ${result.failed} not imported` : ''}.</span>
            {result.messages.map((m) => <span key={m} className="block text-xs">{m}</span>)}
          </Alert>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card mt-5 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-bold">3. Check and import <span className="font-normal text-ink-soft">· {rows.length} rows · <span className="text-emerald-700">{rows.length - bad} ready</span>{bad ? <span className="text-rose-600"> · {bad} with errors (skipped)</span> : ''}</span></p>
            <button className="btn-primary" disabled={busy || rows.length === bad} onClick={run}>{busy ? <><Spinner /> {progress}%</> : `Import ${rows.length - bad} row(s)`}</button>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr><th className="th">#</th><th className="th">Status</th>{kind.cols.map((c) => <th key={c.key} className="th">{c.key}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 300).map((r, i) => (
                  <tr key={i} className={r.errors.length ? 'bg-rose-50/60' : ''}>
                    <td className="td">{i + 1}</td>
                    <td className="td">{r.errors.length ? <span className="text-rose-600" title={r.errors.join(', ')}>{r.errors[0]}</span> : <Badge tone="green">OK</Badge>}</td>
                    {kind.cols.map((c) => <td key={c.key} className="td">{r.row[c.key] === null ? '' : String(r.row[c.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <p className="p-3 text-xs text-ink-muted">Showing first 300 of {rows.length} rows. All valid rows will be imported.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
