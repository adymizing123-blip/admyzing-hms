import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Shell from '@/components/admin/Shell';
import { getSessionProfile } from '@/lib/supabase/server';

export const metadata = { title: 'Hospital Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?next=/admin');
  const path = headers().get('x-pathname') || '/admin';

  // two-step verification
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') redirect(`/mfa?next=${encodeURIComponent(path)}`);
  const { data: sec } = await supabase.from('settings').select('value').eq('key', 'security').maybeSingle();
  const mfaRequired = !!sec?.value?.require_staff_mfa;
  const mustEnroll = mfaRequired && aal?.currentLevel !== 'aal2';

  if (!profile || profile.role === 'patient') redirect('/portal');
  if (mustEnroll && !path.startsWith('/admin/account')) redirect('/admin/account');

  const [{ data: branches }] = await Promise.all([supabase.from('branches').select('id, name, address, timings').eq('active', true).order('name')]);

  return (
    <Shell role={profile.role} name={profile.full_name || profile.email} idleMinutes={Number(sec?.value?.idle_minutes) || 15}
      branches={branches || []} branchId={profile.branch_id || branches?.[0]?.id || null} limited={mustEnroll}>
      {children}
    </Shell>
  );
}
