import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/utils';

/** Returns the signed-in staff profile if their role is allowed, otherwise null. Admin is always allowed. */
export async function requireRole(roles: Role[]) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('id, role').eq('id', user.id).single();
  if (!profile || (profile.role !== 'admin' && !roles.includes(profile.role))) return null;
  return profile;
}
