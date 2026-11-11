'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { HeartPulse } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';

function Reset() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const code = params.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) return setErr('This reset link has expired or was already used. Request a new one.');
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setErr('This reset link has expired or was already used. Request a new one.');
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== pw2) return setErr('Passwords do not match.');
    setBusy(true); setErr('');
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    setDone(true);
    setTimeout(() => router.push('/login'), 1500);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <Link href="/" className="mb-6 flex items-center gap-2 font-extrabold"><HeartPulse className="text-brand-600" /> CarePlus</Link>
        <h1 className="text-xl font-bold">Choose a new password</h1>
        <div className="mt-5 space-y-4">
          {err && <Alert>{err} {!ready && <Link href="/login" className="font-semibold underline">Back to sign in</Link>}</Alert>}
          {done && <Alert tone="green">Password updated. Taking you to sign in...</Alert>}
          {ready && !done && (
            <form onSubmit={save} className="space-y-4">
              <label className="block"><span className="label">New password</span><input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required /></label>
              <label className="block"><span className="label">Confirm password</span><input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required /></label>
              <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Update password</button>
            </form>
          )}
          {!ready && !err && <div className="flex justify-center py-6"><Spinner /></div>}
        </div>
      </div>
    </div>
  );
}

export default function Page() { return <Suspense><Reset /></Suspense>; }
