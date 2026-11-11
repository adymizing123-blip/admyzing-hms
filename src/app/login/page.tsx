'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { HeartPulse } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, Spinner } from '@/components/ui';
import { useT } from '@/components/site/lang';

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    if (mode === 'forgot') {
      const { error: err } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: `${window.location.origin}/reset-password` });
      setLoading(false);
      if (err) return setError(err.message);
      return setInfo('If an account exists for this email, a reset link is on its way. Check your inbox.');
    }
    if (mode === 'signup') {
      const { data, error: err } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { full_name: form.full_name, phone: form.phone } },
      });
      setLoading(false);
      if (err) return setError(err.message);
      if (!data.session) return setInfo('Account created. Please check your email to confirm, then sign in.');
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
      if (err) { setLoading(false); return setError(err.message); }
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      router.push(`/mfa?next=${encodeURIComponent(params.get('next') || '/admin')}`);
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user!.id).single();
    const next = params.get('next');
    const staff = profile && profile.role !== 'patient';
    router.push(next && (staff || !next.startsWith('/admin')) ? next : staff ? '/admin' : '/portal');
    router.refresh();
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-700 lg:block">
        <img src="https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=1400&q=80" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Link href="/" className="flex items-center gap-2 text-xl font-extrabold"><HeartPulse /> CarePlus Hospital</Link>
          <div>
            <h2 className="text-4xl font-extrabold leading-tight">Your health,<br />all in one place.</h2>
            <p className="mt-4 max-w-md text-brand-50/90">Patients can book visits, view prescriptions and lab reports. Staff manage the entire hospital from one dashboard.</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2 text-lg font-extrabold lg:hidden"><HeartPulse className="text-brand-600" /> CarePlus</Link>
          <h1 className="text-2xl font-bold">{t(mode === 'signin' ? 'Welcome back' : mode === 'forgot' ? 'Reset your password' : 'Create your account')}</h1>
          <p className="mt-1 text-sm text-ink-soft">{t(mode === 'signin' ? 'Sign in to your patient portal or staff dashboard.' : mode === 'forgot' ? 'Enter your email and we will send you a reset link.' : 'Access appointments, reports and orders online.')}</p>
          {params.get('reason') === 'idle' && <div className="mt-4"><Alert tone="amber">You were signed out after a period of inactivity.</Alert></div>}
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && <Alert>{error}</Alert>}
            {info && <Alert tone="green">{info}</Alert>}
            {mode === 'signup' && (
              <>
                <label className="block"><span className="label">{t('Full name')}</span><input className="input" required value={form.full_name} onChange={set('full_name')} /></label>
                <label className="block"><span className="label">{t('Phone')}</span><input className="input" type="tel" value={form.phone} onChange={set('phone')} placeholder="(555) 123-4567" /></label>
              </>
            )}
            <label className="block"><span className="label">{t('Email')}</span><input className="input" type="email" required value={form.email} onChange={set('email')} /></label>
            {mode !== 'forgot' && (
              <label className="block">
                <span className="label flex justify-between">{t('Password')} {mode === 'signin' && <button type="button" className="normal-case tracking-normal text-brand-700" onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>{t('Forgot password?')}</button>}</span>
                <input className="input" type="password" required minLength={mode === 'signup' ? 8 : undefined} value={form.password} onChange={set('password')} />
              </label>
            )}
            <button className="btn-primary w-full" disabled={loading}>{loading && <Spinner />}{t(mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create account')}</button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-soft">
            {mode === 'signin' ? t('New patient? ') : mode === 'forgot' ? t('Remembered it? ') : t('Already have an account? ')}
            <button className="font-semibold text-brand-700" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo(''); }}>
              {mode === 'signin' ? t('Create an account') : t('Sign in')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
