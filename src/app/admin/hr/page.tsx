'use client';
import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { PageHeader, Tabs, StatusBadge, Badge, Spinner, Alert } from '@/components/ui';
import { deptOption, roleOptions } from '@/lib/fields';
import { fmtDate, fmtTime, money, titleCase, todayISO } from '@/lib/utils';

const staffOption = { table: 'staff', select: 'id, full_name, role', label: (r: any) => `${r.full_name} (${titleCase(r.role)})`, order: 'full_name', filter: { active: true } };

export default function HR() {
  const [tab, setTab] = useState('staff');
  return (
    <div>
      <PageHeader title="HR & Payroll" subtitle="Staff directory, attendance, duty roster and monthly payroll." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'staff', label: 'Staff' }, { id: 'attendance', label: 'Attendance' }, { id: 'shifts', label: 'Duty roster' }, { id: 'payroll', label: 'Payroll' }]} />

      {tab === 'staff' && (
        <ResourceManager embedded table="staff" branchScoped title="Staff" select="*, departments(name)" orderBy={{ column: 'full_name', ascending: true }}
          searchColumns={['full_name', 'email', 'phone']}
          columns={[
            { key: 'full_name', label: 'Name', render: (r) => <div><p className="font-semibold">{r.full_name}</p><p className="text-xs text-ink-muted">{r.email}</p></div> },
            { key: 'role', label: 'Role', render: (r) => <Badge tone="blue">{titleCase(r.role)}</Badge> },
            { key: 'dept', label: 'Department', render: (r) => r.departments?.name || '-', hideOnMobile: true },
            { key: 'pay', label: 'Pay', render: (r) => r.pay_type === 'hourly' ? `${money(r.hourly_rate)}/hr` : `${money(r.base_salary)}/mo` },
            { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Active' : 'Inactive'}</Badge>, hideOnMobile: true },
          ]}
          fields={[
            { name: 'full_name', label: 'Full name', required: true },
            { name: 'role', label: 'Role', type: 'select', required: true, options: roleOptions.filter((r) => r.value !== 'patient') },
            { name: 'department_id', label: 'Department', type: 'select', optionsFrom: deptOption },
            { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
            { name: 'hire_date', label: 'Hire date', type: 'date' },
            { name: 'pay_type', label: 'Pay type', type: 'select', options: [{ value: 'salary', label: 'Monthly salary' }, { value: 'hourly', label: 'Hourly' }] },
            { name: 'base_salary', label: 'Monthly salary ($)', type: 'number' }, { name: 'hourly_rate', label: 'Hourly rate ($)', type: 'number' },
            { name: 'commission_pct', label: 'Consultation commission (%)', type: 'number' },
            { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          defaults={{ active: true, pay_type: 'salary' }}
          canDelete={false}
        />
      )}

      {tab === 'attendance' && <Attendance />}

      {tab === 'shifts' && (
        <ResourceManager embedded table="shifts" title="Duty roster" select="*, staff(full_name, role)" orderBy={{ column: 'shift_date', ascending: false }}
          columns={[
            { key: 'shift_date', label: 'Date', render: (r) => fmtDate(r.shift_date) },
            { key: 'staff', label: 'Staff', render: (r) => <span className="font-semibold">{r.staff?.full_name}</span> },
            { key: 'role', label: 'Role', render: (r) => titleCase(r.staff?.role), hideOnMobile: true },
            { key: 'shift_name', label: 'Shift', render: (r) => <Badge tone={r.shift_name === 'Night' ? 'violet' : r.shift_name === 'Evening' ? 'amber' : 'blue'}>{r.shift_name}</Badge> },
            { key: 'time', label: 'Time', render: (r) => `${String(r.start_time).slice(0, 5)} to ${String(r.end_time).slice(0, 5)}` },
          ]}
          fields={[
            { name: 'staff_id', label: 'Staff', type: 'select', required: true, optionsFrom: staffOption },
            { name: 'shift_date', label: 'Date', type: 'date', required: true },
            { name: 'shift_name', label: 'Shift', type: 'select', options: ['Morning', 'Evening', 'Night'].map((v) => ({ value: v, label: v })) },
            { name: 'start_time', label: 'Start', type: 'time' }, { name: 'end_time', label: 'End', type: 'time' },
          ]}
          defaults={{ shift_name: 'Morning', start_time: '08:00', end_time: '16:00', shift_date: todayISO() }}
        />
      )}

      {tab === 'payroll' && <Payroll />}
    </div>
  );
}

function Attendance() {
  const supabase = createClient();
  const [date, setDate] = useState(todayISO());
  const [staff, setStaff] = useState<any[]>([]);
  const [att, setAtt] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    const [{ data: s }, { data: a }] = await Promise.all([
      supabase.from('staff').select('id, full_name, role').eq('active', true).order('full_name'),
      supabase.from('attendance').select('*').eq('work_date', date),
    ]);
    setStaff(s || []);
    setAtt(Object.fromEntries((a || []).map((x: any) => [x.staff_id, x])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const mark = async (staffId: string, patch: any) => {
    const ex = att[staffId];
    const res = ex
      ? await supabase.from('attendance').update(patch).eq('id', ex.id)
      : await supabase.from('attendance').insert({ staff_id: staffId, work_date: date, ...patch });
    if (res.error) alert(res.error.message);
    load();
  };

  return (
    <div>
      <input type="date" className="input mb-4 sm:max-w-xs" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="card divide-y divide-slate-100">
        {staff.map((s) => {
          const a = att[s.id];
          return (
            <div key={s.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{s.full_name}</p>
                <p className="text-xs text-ink-muted">{titleCase(s.role)}{a?.check_in ? ` · in ${fmtTime(a.check_in)}` : ''}{a?.check_out ? ` · out ${fmtTime(a.check_out)}` : ''}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {a && <StatusBadge status={a.status} />}
                {!a?.check_in && <button className="btn-primary btn-sm" onClick={() => mark(s.id, { check_in: new Date().toISOString(), status: 'present' })}><LogIn size={14} /> Check in</button>}
                {a?.check_in && !a?.check_out && <button className="btn-secondary btn-sm" onClick={() => mark(s.id, { check_out: new Date().toISOString() })}><LogOut size={14} /> Check out</button>}
                {!a && <button className="btn-ghost btn-sm" onClick={() => mark(s.id, { status: 'absent' })}>Absent</button>}
                {!a && <button className="btn-ghost btn-sm" onClick={() => mark(s.id, { status: 'leave' })}>Leave</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Payroll() {
  const supabase = createClient();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('payroll').select('*, staff(full_name, role, pay_type)').eq('period_start', `${month}-01`).order('net_pay', { ascending: false });
    setRows(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('generate_payroll', { p_month: `${month}-01` });
    setBusy(false);
    setMsg(error ? error.message : `Payroll calculated for ${data} staff members.`);
    load();
  };

  const update = async (id: string, patch: any) => { await supabase.from('payroll').update(patch).eq('id', id); load(); };
  const total = rows.reduce((s, r) => s + Number(r.net_pay), 0);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input type="month" className="input sm:max-w-[200px]" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className="btn-primary" disabled={busy} onClick={generate}>{busy && <Spinner />} Calculate payroll</button>
        <span className="text-sm text-ink-soft sm:ml-auto">Total net pay: <b className="text-ink">{money(total)}</b></span>
      </div>
      <p className="mb-4 text-xs text-ink-muted">Salaried staff get their monthly salary. Hourly staff are paid for checked-in hours. Doctors earn their commission % on paid consultation fees.</p>
      {msg && <div className="mb-4"><Alert tone="green">{msg}</Alert></div>}
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/60"><tr><th className="th">Staff</th><th className="th text-right">Base</th><th className="th text-right">Commission</th><th className="th text-right">Deductions</th><th className="th text-right">Net</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="td py-10 text-center text-ink-muted">No payroll yet for this month. Click Calculate payroll.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="td"><p className="font-semibold">{r.staff?.full_name}</p><p className="text-xs text-ink-muted">{titleCase(r.staff?.role)} · {r.staff?.pay_type}</p></td>
                <td className="td text-right">{money(r.base_pay)}</td>
                <td className="td text-right">{money(r.commission)}</td>
                <td className="td text-right">
                  {r.status === 'pending' ? <input className="input w-24 py-1 text-right" defaultValue={r.deductions} onBlur={(e) => Number(e.target.value) !== Number(r.deductions) && update(r.id, { deductions: Number(e.target.value) || 0 })} /> : money(r.deductions)}
                </td>
                <td className="td text-right font-bold">{money(r.net_pay)}</td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right">{r.status === 'pending' && <button className="btn-secondary btn-sm" onClick={() => update(r.id, { status: 'paid', paid_at: new Date().toISOString() })}>Mark paid</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
