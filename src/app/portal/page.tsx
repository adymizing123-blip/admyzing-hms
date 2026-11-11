import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import PortalTabs from '@/components/portal/PortalTabs';

export default async function Portal() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?next=/portal');
  if (profile && profile.role !== 'patient') redirect('/admin');

  const { data: patient } = await supabase.from('patients').select('*').eq('profile_id', user.id).maybeSingle();
  if (!patient) {
    return <div className="card p-8 text-center text-ink-soft">Your patient record is being set up. Please contact reception.</div>;
  }

  const [appts, visits, labs, invoices, orders, admissions, docs, imms, refills] = await Promise.all([
    supabase.from('appointments').select('*, doctors(id, full_name, specialty)').eq('patient_id', patient.id).order('scheduled_at', { ascending: false }),
    supabase.from('visits').select('*, doctors(id, full_name), prescriptions(*)').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    supabase.from('lab_orders').select('*, lab_order_items(*, lab_tests(name, unit, normal_range))').eq('patient_id', patient.id).order('ordered_at', { ascending: false }),
    supabase.from('invoices').select('*, invoice_items(*)').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    supabase.from('orders').select('*, order_items(*)').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    supabase.from('admissions').select('*').eq('patient_id', patient.id).order('admitted_at', { ascending: false }),
    supabase.from('patient_documents').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    supabase.from('immunizations').select('*, vaccines(name)').eq('patient_id', patient.id).order('given_on', { ascending: false }),
    supabase.from('refill_requests').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }),
  ]);

  // doctors this patient has seen, for addressing messages
  const docMap = new Map<string, any>();
  [...(appts.data || []), ...(visits.data || [])].forEach((x: any) => x.doctors?.id && docMap.set(x.doctors.id, x.doctors));

  return (
    <Suspense>
      <PortalTabs
        patient={patient}
        appointments={appts.data || []}
        visits={visits.data || []}
        labs={labs.data || []}
        invoices={invoices.data || []}
        orders={orders.data || []}
        admissions={admissions.data || []}
        documents={docs.data || []}
        immunizations={imms.data || []}
        refills={refills.data || []}
        doctors={Array.from(docMap.values())}
      />
    </Suspense>
  );
}
