'use client';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/components/site/lang';

export default function SignOutButton() {
  const router = useRouter();
  const t = useT();
  return (
    <button className="btn-ghost btn-sm" onClick={async () => { await createClient().auth.signOut(); router.push('/'); router.refresh(); }}>
      <LogOut size={14} /> <span className="hidden sm:inline">{t('Sign out')}</span>
    </button>
  );
}
