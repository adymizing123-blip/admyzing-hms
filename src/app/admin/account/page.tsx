'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Trash2, KeyRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, Alert, Spinner, Badge } from '@/components/ui';

export default function Account() {
  const supabase = createClient();
  const router = useRouter();
  const [factors, setFactors] = useState<any[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [required, setRequired] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green' | 'amber'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp || []).filter((f: any) => f.status === 'verified'));
    const { data: s } = await supabase.from('settings').select('value').eq('key', 'security').maybeSingle();
    setRequired(!!s?.value?.require_staff_mfa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setMsg(null);
    // remove half-finished enrollments first
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all || []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data: e, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toLocaleDateString()}` });
    if (error) return setMsg({ tone: 'red', text: error.message });
    setEnroll({ id: e.id, qr: e.totp.qr_code, secret: e.totp.secret });
  };

  const verify = async () => {
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll!.id, code: code.replace(/\s/g, '') });
    setBusy(false);
    if (error) return setMsg({ tone: 'red', text: 'That code did not work. Try the newest code from the app.' });
    setEnroll(null); setCode('');
    setMsg({ tone: 'green', text: 'Two-step verification is on. You will be asked for a code each time you sign in.' });
    load(); router.refresh();
  };

  const remove = async (id: string) => {
    if (required && factors.length <= 1) return setMsg({ tone: 'amber', text: 'Your hospital requires two-step verification for staff, so you cannot remove your only authenticator.' });
    if (!confirm('Turn off two-step verification for this authenticator?')) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setMsg(error ? { tone: 'red', text: error.message } : { tone: 'green', text: 'Authenticator removed.' });
    load();
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ tone: 'red', text: 'Use at least 8 characters.' });
    const { error } = await supabase.auth.updateUser({ password: pw });
    setMsg(error ? { tone: 'red', text: error.message } : { tone: 'green', text: 'Password updated.' });
    setPw('');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My account & security" />
      {required && factors.length === 0 && <div className="mb-4"><Alert tone="amber">Your hospital requires two-step verification for all staff. Set it up below to continue using the system.</Alert></div>}
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><ShieldCheck size={20} /></span>
            <div><p className="font-bold">Two-step verification</p><p className="text-sm text-ink-soft">Use Google Authenticator, Microsoft Authenticator, 1Password or Authy.</p></div>
          </div>
          <Badge tone={factors.length ? 'green' : 'gray'}>{factors.length ? 'On' : 'Off'}</Badge>
        </div>

        {factors.map((f) => (
          <div key={f.id} className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
            <span>{f.friendly_name || 'Authenticator app'}</span>
            <button className="btn-ghost btn-sm text-rose-600" onClick={() => remove(f.id)}><Trash2 size={14} /> Remove</button>
          </div>
        ))}

        {!enroll && factors.length === 0 && <button className="btn-primary mt-5" onClick={start}>Set up authenticator app</button>}

        {enroll && (
          <div className="mt-5 space-y-4 rounded-xl border border-slate-200 p-4">
            <p className="text-sm"><b>1.</b> Scan this QR code with your authenticator app.</p>
            <img src={enroll.qr} alt="QR code" className="mx-auto h-48 w-48" />
            <p className="text-center text-xs text-ink-muted">Cannot scan? Enter this key: <span className="font-mono">{enroll.secret}</span></p>
            <p className="text-sm"><b>2.</b> Enter the 6-digit code it shows.</p>
            <div className="flex gap-2">
              <input className="input text-center text-lg tracking-[0.4em]" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
              <button className="btn-primary" disabled={busy || code.replace(/\s/g, '').length !== 6} onClick={verify}>{busy && <Spinner />} Verify</button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={changePw} className="card mt-5 p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><KeyRound size={20} /></span>
          <p className="font-bold">Change password</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input type="password" className="input" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn-primary">Update</button>
        </div>
      </form>
    </div>
  );
}
