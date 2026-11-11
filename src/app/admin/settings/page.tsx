'use client';
import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import ResourceManager from '@/components/admin/ResourceManager';
import { Modal, PageHeader, Tabs, Badge, Alert, Spinner } from '@/components/ui';
import { deptOption, roleOptions } from '@/lib/fields';
import { DEFAULT_HOSPITAL } from '@/lib/settings';
import { fmtDate, fmtDateTime, money, titleCase } from '@/lib/utils';

const profileOption = { table: 'profiles', select: 'id, full_name, email, role', label: (r: any) => `${r.full_name || r.email} (${r.role})`, order: 'full_name' };

export default function Settings() {
  const [tab, setTab] = useState('users');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reload, setReload] = useState(0);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Users and roles, hospital details, departments, doctors, wards and beds." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'users', label: 'Users & roles' }, { id: 'security', label: 'Security' }, { id: 'hospital', label: 'Hospital' }, { id: 'branches', label: 'Branches' }, { id: 'departments', label: 'Departments' },
        { id: 'doctors', label: 'Doctors' }, { id: 'leave', label: 'Doctor leave' }, { id: 'wards', label: 'Wards' }, { id: 'beds', label: 'Beds' }, { id: 'audit', label: 'Audit log' },
      ]} />

      {tab === 'users' && (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-soft">Every sign-up starts as a Patient. Change the role here to give staff access to their modules.</p>
            <button className="btn-primary" onClick={() => setInviteOpen(true)}><UserPlus size={16} /> Create staff login</button>
          </div>
          <ResourceManager embedded table="profiles" title="Users" reloadKey={reload} searchColumns={['full_name', 'email']} canCreate={false} canDelete={false}
            columns={[
              { key: 'full_name', label: 'Name', render: (r) => <div><p className="font-semibold">{r.full_name || '-'}</p><p className="text-xs text-ink-muted">{r.email}</p></div> },
              { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'admin' ? 'red' : r.role === 'patient' ? 'gray' : 'blue'}>{titleCase(r.role)}</Badge> },
              { key: 'created_at', label: 'Joined', render: (r) => fmtDate(r.created_at), hideOnMobile: true },
            ]}
            fields={[{ name: 'full_name', label: 'Full name' }, { name: 'phone', label: 'Phone' }, { name: 'role', label: 'Role', type: 'select', options: roleOptions, required: true },
              { name: 'branch_id', label: 'Home branch', type: 'select', optionsFrom: { table: 'branches', select: 'id, name', label: (r: any) => r.name, order: 'name' } }]}
          />
        </>
      )}

      {tab === 'hospital' && <HospitalSettings />}

      {tab === 'security' && <SecuritySettings />}

      {tab === 'branches' && (
        <ResourceManager embedded table="branches" title="Branches" orderBy={{ column: 'name', ascending: true }} canDelete={false}
          columns={[
            { key: 'name', label: 'Branch', render: (r) => <span className="font-semibold">{r.name}</span> },
            { key: 'code', label: 'Code' }, { key: 'address', label: 'Address', hideOnMobile: true }, { key: 'phone', label: 'Phone', hideOnMobile: true },
            { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Active' : 'Closed'}</Badge> },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true }, { name: 'code', label: 'Short code' }, { name: 'phone', label: 'Phone' },
            { name: 'timezone', label: 'Timezone' }, { name: 'timings', label: 'Clinic timings (printed on prescription)' }, { name: 'address', label: 'Address', full: true }, { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          defaults={{ active: true, timezone: 'America/Chicago' }}
        />
      )}

      {tab === 'departments' && (
        <ResourceManager embedded table="departments" title="Departments" orderBy={{ column: 'name', ascending: true }}
          columns={[{ key: 'name', label: 'Name', render: (r) => <span className="font-semibold">{r.name}</span> }, { key: 'slug', label: 'Slug' }, { key: 'description', label: 'Description', hideOnMobile: true, className: 'whitespace-normal max-w-md' }]}
          fields={[
            { name: 'name', label: 'Name', required: true }, { name: 'slug', label: 'URL slug', required: true },
            { name: 'icon', label: 'Icon', type: 'select', options: ['HeartPulse', 'Bone', 'Baby', 'Brain', 'Stethoscope', 'Flower2', 'Sparkles', 'Siren'].map((v) => ({ value: v, label: v })) },
            { name: 'description', label: 'Description', type: 'textarea' },
          ]}
        />
      )}

      {tab === 'doctors' && (
        <ResourceManager embedded table="doctors" title="Doctors" select="*, departments(name), profiles(email)" orderBy={{ column: 'full_name', ascending: true }} searchColumns={['full_name', 'specialty']}
          columns={[
            { key: 'full_name', label: 'Doctor', render: (r) => <div className="flex items-center gap-3">{r.photo_url && <img src={r.photo_url} alt="" className="h-9 w-9 rounded-full object-cover" />}<div><p className="font-semibold">{r.full_name}</p><p className="text-xs text-ink-muted">{r.specialty}</p></div></div> },
            { key: 'dept', label: 'Department', render: (r) => r.departments?.name || '-', hideOnMobile: true },
            { key: 'consultation_fee', label: 'Fee', render: (r) => money(r.consultation_fee) },
            { key: 'login', label: 'Login', render: (r) => r.profiles?.email || <span className="text-ink-muted">Not linked</span>, hideOnMobile: true },
            { key: 'active', label: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'gray'}>{r.active ? 'Active' : 'Hidden'}</Badge> },
          ]}
          fields={[
            { name: 'full_name', label: 'Full name', required: true }, { name: 'department_id', label: 'Department', type: 'select', optionsFrom: deptOption },
            { name: 'specialty', label: 'Specialty' }, { name: 'qualification', label: 'Qualifications' },
            { name: 'consultation_fee', label: 'Consultation fee ($)', type: 'number', required: true }, { name: 'slot_minutes', label: 'Slot length (min)', type: 'number' },
            { name: 'start_time', label: 'Clinic start', type: 'time' }, { name: 'end_time', label: 'Clinic end', type: 'time' },
            { name: 'available_days', label: 'Available days', type: 'days' },
            { name: 'photo_url', label: 'Photo URL', full: true }, { name: 'bio', label: 'Bio', type: 'textarea' },
            { name: 'profile_id', label: 'Linked user login', type: 'select', optionsFrom: profileOption },
            { name: 'staff_id', label: 'Linked staff record (payroll)', type: 'select', optionsFrom: { table: 'staff', select: 'id, full_name', label: (r: any) => r.full_name, order: 'full_name', filter: { role: 'doctor' } } },
            { name: 'active', label: 'Show on website & booking', type: 'checkbox' },
          ]}
          defaults={{ active: true, slot_minutes: 20, start_time: '09:00', end_time: '17:00', available_days: [1, 2, 3, 4, 5], consultation_fee: 150 }}
        />
      )}

      {tab === 'leave' && (
        <>
          <p className="mb-4 text-sm text-ink-soft">Leave days are hidden from online booking and no one can book the doctor on those days.</p>
          <ResourceManager embedded table="doctor_leaves" title="Doctor leave" select="*, doctors(full_name)" orderBy={{ column: 'start_date', ascending: false }}
            columns={[
              { key: 'doctor', label: 'Doctor', render: (r) => <span className="font-semibold">{r.doctors?.full_name}</span> },
              { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
              { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
              { key: 'reason', label: 'Reason' },
            ]}
            fields={[
              { name: 'doctor_id', label: 'Doctor', type: 'select', required: true, optionsFrom: { table: 'doctors', select: 'id, full_name', label: (r: any) => r.full_name, order: 'full_name' } },
              { name: 'reason', label: 'Reason (vacation, conference...)' },
              { name: 'start_date', label: 'From', type: 'date', required: true },
              { name: 'end_date', label: 'To', type: 'date', required: true },
            ]}
          />
        </>
      )}

      {tab === 'wards' && (
        <ResourceManager embedded table="wards" title="Wards" orderBy={{ column: 'name', ascending: true }}
          columns={[{ key: 'name', label: 'Ward', render: (r) => <span className="font-semibold">{r.name}</span> }, { key: 'ward_type', label: 'Type', render: (r) => titleCase(r.ward_type) }, { key: 'daily_rate', label: 'Daily rate', render: (r) => money(r.daily_rate) }]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'ward_type', label: 'Type', type: 'select', options: ['general', 'private', 'icu', 'maternity', 'pediatric'].map((v) => ({ value: v, label: titleCase(v) })) },
            { name: 'daily_rate', label: 'Daily rate ($)', type: 'number', required: true },
          ]}
        />
      )}

      {tab === 'beds' && (
        <ResourceManager embedded table="beds" title="Beds" select="*, wards(name)" orderBy={{ column: 'bed_no', ascending: true }} searchColumns={['bed_no']}
          columns={[{ key: 'bed_no', label: 'Bed', render: (r) => <span className="font-semibold">{r.bed_no}</span> }, { key: 'ward', label: 'Ward', render: (r) => r.wards?.name }, { key: 'status', label: 'Status', render: (r) => titleCase(r.status) }]}
          fields={[
            { name: 'ward_id', label: 'Ward', type: 'select', required: true, optionsFrom: { table: 'wards', select: 'id, name', label: (r: any) => r.name, order: 'name' } },
            { name: 'bed_no', label: 'Bed number', required: true },
            { name: 'status', label: 'Status', type: 'select', options: ['available', 'occupied', 'cleaning', 'maintenance'].map((v) => ({ value: v, label: titleCase(v) })) },
          ]}
          defaults={{ status: 'available' }}
        />
      )}

      {tab === 'audit' && (
        <ResourceManager embedded table="audit_logs" title="Audit log" select="*" canCreate={false} canEdit={false} canDelete={false} searchColumns={['table_name', 'action']}
          columns={[
            { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
            { key: 'table_name', label: 'Record', render: (r) => <span className="font-semibold">{titleCase(r.table_name)}</span> },
            { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action === 'DELETE' ? 'red' : r.action === 'INSERT' ? 'green' : 'blue'}>{r.action}</Badge> },
            { key: 'changed_by', label: 'User ID', render: (r) => <span className="font-mono text-xs">{r.changed_by?.slice(0, 8) || 'system'}</span>, hideOnMobile: true },
          ]}
        />
      )}

      <CreateUser open={inviteOpen} onClose={() => setInviteOpen(false)} onSaved={() => setReload((x) => x + 1)} />
    </div>
  );
}

function SecuritySettings() {
  const supabase = createClient();
  const [v, setV] = useState<any>({ require_staff_mfa: false, idle_minutes: 15 });
  const [aal, setAal] = useState('');
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'amber'; text: string } | null>(null);
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'security').maybeSingle().then(({ data }) => data && setV(data.value));
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data?.currentLevel || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async () => {
    if (v.require_staff_mfa && aal !== 'aal2') {
      return setMsg({ tone: 'amber', text: 'Set up two-step verification for your own account first (My account), sign in again with your code, then turn this on. Otherwise you would lock yourself out.' });
    }
    const { error } = await supabase.from('settings').upsert({ key: 'security', value: { ...v, idle_minutes: Number(v.idle_minutes) || 15 } });
    setMsg(error ? { tone: 'red', text: error.message } : { tone: 'green', text: 'Security settings saved.' });
  };
  return (
    <div className="card max-w-2xl space-y-5 p-5 sm:p-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={!!v.require_staff_mfa} onChange={(e) => setV({ ...v, require_staff_mfa: e.target.checked })} />
        <span><span className="font-semibold">Require two-step verification for all staff</span>
          <span className="block text-sm text-ink-soft">Staff must use an authenticator app code at every sign-in. Enforced by the database too: without it, staff see no patient data. Patients are not affected.</span></span>
      </label>
      <label className="block max-w-xs"><span className="label">Sign staff out after inactivity (minutes)</span>
        <input type="number" min={2} max={240} className="input" value={v.idle_minutes} onChange={(e) => setV({ ...v, idle_minutes: e.target.value })} /></label>
      <button className="btn-primary" onClick={save}>Save</button>
    </div>
  );
}

function HospitalSettings() {
  const supabase = createClient();
  const [h, setH] = useState<any>(DEFAULT_HOSPITAL);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'hospital').maybeSingle().then(({ data }) => data && setH({ ...DEFAULT_HOSPITAL, ...data.value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('settings').upsert({ key: 'hospital', value: { ...h, tax_rate: Number(h.tax_rate) } });
    setMsg(error ? error.message : 'Saved. The website and invoices now use these details.');
  };
  return (
    <form onSubmit={save} className="card max-w-2xl space-y-4 p-5 sm:p-6">
      {msg && <Alert tone={msg.startsWith('Saved') ? 'green' : 'red'}>{msg}</Alert>}
      {[['name', 'Hospital name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['tax_rate', 'Sales tax rate (%) for pharmacy'], ['npi', 'NPI (billing provider, for insurance claims)'], ['tax_id', 'Tax ID / EIN (for insurance claims)'], ['timezone', 'Timezone (e.g. America/Chicago)']].map(([k, l]) => (
        <label key={k} className="block"><span className="label">{l}</span><input className="input" value={h[k] ?? ''} onChange={(e) => setH({ ...h, [k]: e.target.value })} /></label>
      ))}
      <button className="btn-primary">Save</button>
    </form>
  );
}

function CreateUser({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [f, setF] = useState({ full_name: '', email: '', password: '', role: 'receptionist', doctor_id: '', staff_id: '' });
  const [doctors, setDoctors] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    supabase.from('doctors').select('id, full_name').is('profile_id', null).order('full_name').then(({ data }) => setDoctors(data || []));
    supabase.from('staff').select('id, full_name, role').is('profile_id', null).order('full_name').then(({ data }) => setStaff(data || []));
    setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/admin/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error);
    setF({ full_name: '', email: '', password: '', role: 'receptionist', doctor_id: '', staff_id: '' });
    onSaved(); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create staff login">
      <form onSubmit={save} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <label className="block"><span className="label">Full name</span><input className="input" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="block"><span className="label">Email</span><input type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="block"><span className="label">Temporary password</span><input className="input" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label className="block"><span className="label">Role</span><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roleOptions.filter((r) => r.value !== 'patient').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
        {f.role === 'doctor' && (
          <label className="block"><span className="label">Link to doctor profile</span><select className="input" value={f.doctor_id} onChange={(e) => setF({ ...f, doctor_id: e.target.value })}><option value="">None</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
        )}
        <label className="block"><span className="label">Link to staff record</span><select className="input" value={f.staff_id} onChange={(e) => setF({ ...f, staff_id: e.target.value })}><option value="">None</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({titleCase(s.role)})</option>)}</select></label>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Create login</button></div>
      </form>
    </Modal>
  );
}
