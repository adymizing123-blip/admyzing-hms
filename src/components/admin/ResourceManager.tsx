'use client';

/**
 * Shared, config-driven CRUD screen used by most admin modules.
 * One component = consistent list, search, pagination, add/edit form and mobile cards everywhere.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Modal, PageHeader, Empty, Spinner, Alert } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useBranch } from './branch';

export type Column = {
  key: string;
  label: string;
  render?: (row: any) => React.ReactNode;
  className?: string;
  hideOnMobile?: boolean;
};

export type FieldDef = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'datetime' | 'time' | 'textarea' | 'select' | 'checkbox' | 'days';
  options?: { value: string; label: string }[];
  optionsFrom?: { table: string; select?: string; label: (r: any) => string; value?: string; order?: string; filter?: Record<string, any> };
  required?: boolean;
  placeholder?: string;
  full?: boolean;
  step?: string;
};

type Props = {
  table: string;
  /** Table to insert/update/delete when `table` is a read-only view. */
  writeTable?: string;
  title: string;
  subtitle?: string;
  select?: string;
  columns: Column[];
  fields?: FieldDef[];
  searchColumns?: string[];
  orderBy?: { column: string; ascending?: boolean };
  filters?: Record<string, any>;
  defaults?: Record<string, any>;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  rowActions?: (row: any, reload: () => void) => React.ReactNode;
  headerActions?: React.ReactNode;
  onRowClick?: (row: any) => void;
  pageSize?: number;
  embedded?: boolean;
  reloadKey?: number;
  /** Only show rows of the current branch (table must have branch_id). */
  branchScoped?: boolean;
  /** Show only rows whose related record (e.g. 'invoices', 'patients') belongs to the current branch. `select` must embed that relation. */
  branchVia?: string;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toInputValue(type: FieldDef['type'], v: any) {
  if (v === null || v === undefined) return type === 'days' ? [] : type === 'checkbox' ? false : '';
  if (type === 'datetime') {
    const d = new Date(v);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  if (type === 'time') return String(v).slice(0, 5);
  return v;
}

function fromInputValue(type: FieldDef['type'], v: any) {
  if (type === 'checkbox' || type === 'days') return v;
  if (v === '' || v === undefined) return null;
  if (type === 'number') return Number(v);
  if (type === 'datetime') return new Date(v).toISOString();
  return v;
}

export default function ResourceManager({
  table, writeTable, title, subtitle, select = '*', columns, fields = [], searchColumns = [], orderBy = { column: 'created_at', ascending: false },
  filters, defaults = {}, canCreate = true, canEdit = true, canDelete = true, rowActions, headerActions, onRowClick,
  pageSize = 25, embedded, reloadKey, branchScoped, branchVia,
}: Props) {
  const supabase = createClient();
  const { branchId } = useBranch();
  const [rows, setRows] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  const filterKey = JSON.stringify(filters || {});

  const load = useCallback(async () => {
    setLoading(true);
    const viaOn = !!(branchVia && branchId && select.includes(`${branchVia}(`));
    let query = supabase.from(table).select(viaOn ? select.replace(`${branchVia}(`, `${branchVia}!inner(`) : select, { count: 'exact' });
    if (branchScoped && branchId) query = query.eq('branch_id', branchId);
    if (viaOn) query = query.eq(`${branchVia}.branch_id`, branchId);
    Object.entries(filters || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== '' && v !== null) query = query.eq(k, v);
    });
    if (q && searchColumns.length) {
      const term = q.replace(/[%,()]/g, ' ').trim();
      query = query.or(searchColumns.map((c) => `${c}.ilike.%${term}%`).join(','));
    }
    if (orderBy) query = query.order(orderBy.column, { ascending: !!orderBy.ascending });
    const { data, count: c, error: e } = await query.range(page * pageSize, page * pageSize + pageSize - 1);
    if (e) setError(e.message);
    setRows(data || []);
    setCount(c || 0);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, select, q, page, filterKey, reloadKey, branchId]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // load select options once
  useEffect(() => {
    fields.filter((f) => f.optionsFrom).forEach(async (f) => {
      const o = f.optionsFrom!;
      let query = supabase.from(o.table).select(o.select || '*');
      Object.entries(o.filter || {}).forEach(([k, v]) => (query = query.eq(k, v)));
      if (o.order) query = query.order(o.order);
      const { data } = await query.limit(1000);
      setOptions((prev) => ({ ...prev, [f.name]: (data || []).map((r: any) => ({ value: r[o.value || 'id'], label: o.label(r) })) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    const init: Record<string, any> = {};
    fields.forEach((f) => (init[f.name] = toInputValue(f.type, defaults[f.name])));
    setForm(init);
    setEditing({});
    setError('');
  };

  const openEdit = (row: any) => {
    const init: Record<string, any> = {};
    fields.forEach((f) => (init[f.name] = toInputValue(f.type, row[f.name])));
    setForm(init);
    setEditing(row);
    setError('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload: Record<string, any> = { ...defaults };
    if (branchScoped && branchId && !editing?.id) payload.branch_id = branchId;
    fields.forEach((f) => (payload[f.name] = fromInputValue(f.type, form[f.name])));
    const res = editing?.id
      ? await supabase.from(writeTable || table).update(payload).eq('id', editing.id)
      : await supabase.from(writeTable || table).insert(payload);
    setSaving(false);
    if (res.error) return setError(res.error.message);
    setEditing(null);
    load();
  };

  const remove = async (row: any) => {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    const { error: e } = await supabase.from(writeTable || table).delete().eq('id', row.id);
    if (e) return alert(e.message);
    load();
  };

  const pages = Math.max(1, Math.ceil(count / pageSize));
  const mobileCols = useMemo(() => columns.filter((c) => !c.hideOnMobile), [columns]);
  const cell = (c: Column, r: any) => (c.render ? c.render(r) : r[c.key] ?? '-');
  const showActions = canEdit || canDelete || rowActions;

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={
            <>
              {headerActions}
              {canCreate && fields.length > 0 && (
                <button className="btn-primary" onClick={openNew}>
                  <Plus size={16} /> Add new
                </button>
              )}
            </>
          }
        />
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          {searchColumns.length > 0 ? (
            <div className="relative w-full sm:max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input className="input pl-9" placeholder="Search..." value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            </div>
          ) : <span className="text-sm font-semibold">{embedded ? title : ''}</span>}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">{count} record{count === 1 ? '' : 's'}</span>
            {embedded && canCreate && fields.length > 0 && (
              <button className="btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Add</button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12 text-ink-muted"><Spinner /></div>
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/60">
                  <tr>
                    {columns.map((c) => <th key={c.key} className="th">{c.label}</th>)}
                    {showActions && <th className="th text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className={cn('hover:bg-slate-50/60', onRowClick && 'cursor-pointer')} onClick={() => onRowClick?.(r)}>
                      {columns.map((c) => <td key={c.key} className={cn('td', c.className)}>{cell(c, r)}</td>)}
                      {showActions && (
                        <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            {rowActions?.(r, load)}
                            {canEdit && fields.length > 0 && (
                              <button className="btn-ghost btn-sm" onClick={() => openEdit(r)} aria-label="Edit"><Pencil size={14} /></button>
                            )}
                            {canDelete && (
                              <button className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50" onClick={() => remove(r)} aria-label="Delete"><Trash2 size={14} /></button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => (
                <div key={r.id} className="p-4" onClick={() => onRowClick?.(r)}>
                  <div className="space-y-1.5">
                    {mobileCols.map((c, i) => (
                      <div key={c.key} className={cn('flex items-start justify-between gap-3', i === 0 && 'font-semibold')}>
                        {i > 0 && <span className="text-xs text-ink-muted">{c.label}</span>}
                        <span className={cn('text-sm', i > 0 && 'text-right')}>{cell(c, r)}</span>
                      </div>
                    ))}
                  </div>
                  {showActions && (
                    <div className="mt-3 flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {rowActions?.(r, load)}
                      {canEdit && fields.length > 0 && <button className="btn-secondary btn-sm" onClick={() => openEdit(r)}><Pencil size={13} /> Edit</button>}
                      {canDelete && <button className="btn-secondary btn-sm text-rose-600" onClick={() => remove(r)}><Trash2 size={13} /></button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-ink-soft">Page {page + 1} of {pages}</span>
            <div className="flex gap-1">
              <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
              <button className="btn-secondary btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${title.replace(/s$/, '')}` : `New ${title.replace(/s$/, '')}`} wide={fields.length > 6}>
        <form onSubmit={save} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <FormField key={f.name} f={f} value={form[f.name]} options={f.options || options[f.name] || []}
                onChange={(v) => setForm((p) => ({ ...p, [f.name]: v }))} />
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" disabled={saving}>{saving && <Spinner />} Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function FormField({ f, value, onChange, options }: { f: FieldDef; value: any; onChange: (v: any) => void; options: { value: string; label: string }[] }) {
  const full = f.full || f.type === 'textarea' || f.type === 'days';
  const wrap = (el: React.ReactNode) => (
    <label className={cn('block', full && 'sm:col-span-2')}>
      <span className="label">{f.label}{f.required && <span className="text-rose-500"> *</span>}</span>
      {el}
    </label>
  );
  switch (f.type) {
    case 'textarea':
      return wrap(<textarea className="input min-h-[90px]" value={value} required={f.required} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />);
    case 'select':
      return wrap(
        <select className="input" value={value ?? ''} required={f.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select...</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>,
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 rounded accent-brand-600" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {f.label}
        </label>
      );
    case 'days':
      return wrap(
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
            const on = (value || []).includes(i);
            return (
              <button type="button" key={d} onClick={() => onChange(on ? value.filter((x: number) => x !== i) : [...(value || []), i].sort())}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold ring-1', on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-soft ring-slate-200')}>
                {d}
              </button>
            );
          })}
        </div>,
      );
    default:
      return wrap(
        <input
          className="input"
          type={f.type === 'datetime' ? 'datetime-local' : f.type || 'text'}
          step={f.step || (f.type === 'number' ? 'any' : undefined)}
          value={value ?? ''}
          required={f.required}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />,
      );
  }
}
