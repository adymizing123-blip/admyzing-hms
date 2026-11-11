'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Modal, Alert, Spinner } from '@/components/ui';
import PatientPicker, { type PickedPatient } from './PatientPicker';
import { patientFields } from '@/lib/fields';
import { FormField } from './ResourceManager';
import { useBranch } from './branch';

/** Book or register a walk-in. Used by Appointments and OPD screens. */
export default function NewAppointment({ open, onClose, onSaved, walkIn, presetPatientId }: {
  open: boolean; onClose: () => void; onSaved: () => void; walkIn?: boolean; presetPatientId?: string;
}) {
  const supabase = createClient();
  const { branchId } = useBranch();
  const [clinics, setClinics] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [np, setNp] = useState<any>({});
  const [f, setF] = useState({ doctor_id: '', branch_id: '', when: '', reason: '', source: walkIn ? 'walk_in' : 'phone', visit_type: 'in_person' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('branches').select('id, name').eq('active', true).order('name').then(({ data }) => setClinics(data || []));
    supabase.from('doctors').select('id, full_name, slot_minutes').eq('active', true).order('full_name').then(({ data }) => setDoctors(data || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!presetPatientId) return;
    supabase.from('patients').select('id, first_name, last_name, mrn, phone').eq('id', presetPatientId).single().then(({ data }) => data && setPatient(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetPatientId]);

  useEffect(() => {
    if (open) {
      const d = new Date();
      d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
      setF((x) => ({ ...x, when: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }));
      setF((x) => ({ ...x, branch_id: x.branch_id || branchId || '' }));
      setErr('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    let pid = patient?.id;
    if (newMode) {
      const payload: any = {};
      patientFields.slice(0, 6).forEach((x) => (payload[x.name] = np[x.name] || null));
      const { data, error } = await supabase.from('patients').insert(payload).select('id').single();
      if (error) { setBusy(false); return setErr(error.message); }
      pid = data.id;
    }
    if (!pid) { setBusy(false); return setErr('Select or register a patient'); }
    const when = new Date(f.when);
    const { data: token } = await supabase.rpc('next_token', { p_doctor_id: f.doctor_id, p_date: f.when.slice(0, 10) });
    const { error } = await supabase.from('appointments').insert({
      patient_id: pid, doctor_id: f.doctor_id, branch_id: f.branch_id || null, scheduled_at: when.toISOString(), reason: f.reason || null,
      source: f.source, token_no: token, status: walkIn ? 'checked_in' : 'booked', visit_type: f.visit_type,
    });
    setBusy(false);
    if (error) return setErr(error.message.includes('appointments_slot_unique') ? 'This doctor already has a booking at that time.' : error.message);
    setPatient(null); setNp({}); setNewMode(false);
    fetch('/api/automations/run', { method: 'POST' }).catch(() => {}); // send the booking confirmation now
    onSaved();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={walkIn ? 'Walk-in patient' : 'New appointment'} wide>
      <form onSubmit={save} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div className="flex items-center justify-between">
          <span className="label mb-0">Patient</span>
          <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => setNewMode(!newMode)}>{newMode ? 'Search existing' : '+ Register new patient'}</button>
        </div>
        {newMode ? (
          <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
            {patientFields.slice(0, 6).map((x) => <FormField key={x.name} f={x} value={np[x.name] ?? ''} options={x.options || []} onChange={(v) => setNp({ ...np, [x.name]: v })} />)}
          </div>
        ) : <PatientPicker value={patient} onChange={setPatient} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="label">Clinic (where the patient came) *</span>
            <select className="input" required value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}>
              <option value="">Select clinic...</option>
              {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="block"><span className="label">Doctor *</span>
            <select className="input" required value={f.doctor_id} onChange={(e) => setF({ ...f, doctor_id: e.target.value })}>
              <option value="">Select doctor...</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select></label>
          <label className="block"><span className="label">Date & time *</span><input type="datetime-local" className="input" required value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></label>
          <label className="block"><span className="label">How they found us</span>
            <select className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
              <option value="walk_in">Walk-in</option><option value="phone">Phone call</option><option value="web">Website</option>
              <option value="whatsapp">WhatsApp</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option>
              <option value="google">Google</option><option value="referral">Referral</option><option value="other">Other</option>
            </select></label>
          <label className="block"><span className="label">Visit type</span>
            <select className="input" value={f.visit_type} onChange={(e) => setF({ ...f, visit_type: e.target.value })}>
              <option value="in_person">At the hospital</option><option value="video">Video visit</option>
            </select></label>
          <label className="block sm:col-span-2"><span className="label">Reason</span><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Save</button></div>
      </form>
    </Modal>
  );
}
