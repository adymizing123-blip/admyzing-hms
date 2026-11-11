'use client';
import { useEffect, useState } from 'react';
import { visitSource } from '@/lib/visit-source';
import { MapPin, Phone, Mail, Clock, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';
import { DEFAULT_HOSPITAL as h } from '@/lib/settings';
import { useT } from '@/components/site/lang';

export default function Contact() {
  const t = useT();
  const [form, setForm] = useState({ name: '', email: '', phone: '', interest: 'General inquiry', message: '', branch_id: '' });
  const [clinics, setClinics] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { createClient().from('branches').select('id, name').eq('active', true).order('name').then(({ data }) => setClinics(data || [])); }, []);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    const v = visitSource();
    const { error: err } = await createClient().from('leads').insert({
      ...form, branch_id: form.branch_id || null, source: v?.source || 'website', source_detail: v?.detail || null, status: 'new',
    });
    if (err) { setError(err.message); setState('idle'); return; }
    fetch('/api/automations/kick', { method: 'POST' }).catch(() => {});
    setState('sent');
  };

  return (
    <div className="container-x grid gap-10 py-12 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('Contact us')}</h1>
        <p className="mt-2 text-ink-soft">{t('Questions about appointments, billing or insurance? We usually reply within one business day.')}</p>
        <ul className="mt-8 space-y-5">
          {[
            [<MapPin key="a" />, 'Address', h.address],
            [<Phone key="b" />, 'Phone', h.phone],
            [<Mail key="c" />, 'Email', h.email],
            [<Clock key="d" />, 'Hours', 'Clinics Mon to Sat 8 AM to 8 PM · Emergency 24/7'],
          ].map(([icon, t, v]) => (
            <li key={t as string} className="flex gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{icon}</span>
              <div><p className="text-sm font-semibold">{t}</p><p className="text-sm text-ink-soft">{v}</p></div>
            </li>
          ))}
        </ul>
      </div>
      <div className="card p-6 sm:p-8 lg:col-span-3">
        {state === 'sent' ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto text-brand-600" size={48} />
            <h2 className="mt-4 text-xl font-bold">{t('Message received')}</h2>
            <p className="mt-1 text-ink-soft">{t('Our team will get back to you shortly.')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
            <label className="block"><span className="label">{t('Name')}</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block"><span className="label">{t('Email')}</span><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="block"><span className="label">{t('Phone')}</span><input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="block"><span className="label">{t('Topic')}</span>
              <select className="input" value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })}>
                {['General inquiry', 'Appointments', 'Billing & insurance', 'Health packages', 'Store order', 'Careers'].map((o) => <option key={o} value={o}>{t(o)}</option>)}
              </select>
            </label>
            {clinics.length > 1 && (
              <label className="block sm:col-span-2"><span className="label">{t('Clinic')}</span>
                <select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                  <option value="">{t('Any clinic')}</option>
                  {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            <label className="block sm:col-span-2"><span className="label">{t('Message')}</span><textarea className="input min-h-[130px]" required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <div className="sm:col-span-2"><button className="btn-primary w-full sm:w-auto" disabled={state === 'sending'}>{state === 'sending' && <Spinner />} Send message</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
