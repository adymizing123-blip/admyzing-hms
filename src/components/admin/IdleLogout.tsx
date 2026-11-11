'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const KEY = 'careplus_last_activity';

/** Signs staff out after a period without mouse/keyboard/touch activity. Shared across tabs. */
export default function IdleLogout({ minutes }: { minutes: number }) {
  const router = useRouter();
  const [warn, setWarn] = useState<number | null>(null);
  const timer = useRef<any>(null);

  useEffect(() => {
    if (!minutes || minutes <= 0) return;
    const limit = minutes * 60_000;
    const touch = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch {} setWarn(null); };
    const last = () => { try { return Number(localStorage.getItem(KEY)) || Date.now(); } catch { return Date.now(); } };
    touch();
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    let throttle = 0;
    const onAct = () => { if (Date.now() - throttle > 5000) { throttle = Date.now(); touch(); } };
    events.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    timer.current = setInterval(async () => {
      const idle = Date.now() - last();
      if (idle >= limit) {
        clearInterval(timer.current);
        await createClient().auth.signOut();
        router.push('/login?reason=idle');
      } else if (idle >= limit - 60_000) {
        setWarn(Math.ceil((limit - idle) / 1000));
      } else setWarn(null);
    }, 1000);
    return () => { events.forEach((e) => window.removeEventListener(e, onAct)); clearInterval(timer.current); };
  }, [minutes, router]);

  if (warn == null) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <p className="text-lg font-bold">Are you still there?</p>
        <p className="mt-1 text-sm text-ink-soft">For patient privacy you will be signed out in <b>{warn}s</b>.</p>
        <button className="btn-primary mt-5 w-full" onClick={() => { try { localStorage.setItem(KEY, String(Date.now())); } catch {} setWarn(null); }}>Stay signed in</button>
      </div>
    </div>
  );
}
