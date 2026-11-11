'use client';
import { useState } from 'react';
import { Phone, CheckCircle2, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';
import { useT } from '@/components/site/lang';

export default function AmbulanceRequest() {
  const t = useT();
  const [f, setF] = useState({ name: '', phone: '', pickup: '', destination: '', when: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ref, setRef] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { data, error } = await createClient().rpc('request_transport', {
      p_name: f.name, p_phone: f.phone, p_pickup: f.pickup, p_destination: f.destination || null,
      p_when: f.when ? new Date(f.when).toISOString() : null, p_notes: f.notes || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setRef(data as string);
  };

  return (
    <div className="container-x max-w-2xl py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">{t('Non-emergency ambulance transport')}</h1>
      <a href="tel:911" className="mt-5 flex items-center gap-3 rounded-2xl bg-rose-600 p-4 font-bold text-white"><AlertTriangle /> {t('Emergency? Call 911 now.')} <Phone className="ml-auto" /></a>
      <p className="mt-4 text-ink-soft">{t('For hospital transfers, discharges and rides to appointments. We will call you to confirm.')}</p>
      <div className="card mt-6 p-6">
        {ref ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto text-brand-600" size={48} />
            <h2 className="mt-3 text-xl font-bold">{t('Request received')}</h2>
            <p className="mt-1 text-ink-soft">{t('Reference')}: <b>{ref}</b>. {t('We will call you shortly to confirm.')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
            <label className="block"><span className="label">{t('Name')}</span><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="block"><span className="label">{t('Phone')}</span><input className="input" type="tel" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="block sm:col-span-2"><span className="label">{t('Pickup address')}</span><input className="input" required value={f.pickup} onChange={(e) => setF({ ...f, pickup: e.target.value })} /></label>
            <label className="block"><span className="label">{t('Destination')}</span><input className="input" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="CarePlus Hospital" /></label>
            <label className="block"><span className="label">{t('Pickup date & time')}</span><input className="input" type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></label>
            <label className="block sm:col-span-2"><span className="label">{t('Notes (mobility, oxygen, wheelchair...)')}</span><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
            <div className="sm:col-span-2"><button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy && <Spinner />} {t('Request transport')}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
