'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';

/** Second step of sign-in for staff with an authenticator app. */
function MFA() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const f = data?.totp?.find((x: any) => x.status === 'verified');
      if (f) setFactorId(f.id); else router.replace('/admin/account');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
    setBusy(false);
    if (error) return setErr('That code did not work. Check the time on your phone and try the newest code.');
    router.push(params.get('next') || '/admin');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={verify} className="card w-full max-w-sm space-y-4 p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600"><ShieldCheck /></span>
        <h1 className="text-xl font-bold">Two-step verification</h1>
        <p className="text-sm text-ink-soft">Enter the 6-digit code from your authenticator app.</p>
        {err && <Alert>{err}</Alert>}
        <input className="input text-center text-2xl tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        <button className="btn-primary w-full" disabled={busy || code.replace(/\s/g, '').length !== 6 || !factorId}>{busy && <Spinner />} Verify</button>
        <button type="button" className="text-sm text-ink-soft" onClick={async () => { await supabase.auth.signOut(); router.push('/login'); }}>Use a different account</button>
      </form>
    </div>
  );
}

export default function Page() { return <Suspense><MFA /></Suspense>; }
