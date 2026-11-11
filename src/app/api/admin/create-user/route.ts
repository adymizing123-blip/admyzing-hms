import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Admin creates a staff login (email + temporary password) and assigns a role. */
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin') return NextResponse.json({ error: 'Only admins can create users' }, { status: 403 });

  const { email, password, full_name, role, doctor_id, staff_id } = await req.json();
  if (!email || !password || !role) return NextResponse.json({ error: 'Email, password and role are required' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const uid = data.user.id;
  await admin.from('profiles').update({ role, full_name }).eq('id', uid);
  if (role !== 'patient') await admin.from('patients').delete().eq('profile_id', uid); // staff do not need a patient record
  if (doctor_id) await admin.from('doctors').update({ profile_id: uid }).eq('id', doctor_id);
  if (staff_id) await admin.from('staff').update({ profile_id: uid }).eq('id', staff_id);
  return NextResponse.json({ id: uid });
}
