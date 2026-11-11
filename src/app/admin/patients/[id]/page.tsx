import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSessionProfile } from '@/lib/supabase/server';
import PatientRecord from '@/components/admin/PatientRecord';

export default async function PatientPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await getSessionProfile();
  const { data: patient } = await supabase.from('patients').select('*').eq('id', params.id).maybeSingle();
  if (!patient) notFound();

  const [appts, visits, labs, invoices, admissions, docs, imms] = await Promise.all([
    supabase.from('appointments').select('*, doctors(full_name)').eq('patient_id', patient.id).order('scheduled_at', { ascending: false }),
    supabase.from('visits').select('*, doctors(full_name), prescriptions(*)').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    supabase.from('lab_orders').select('*, lab_order_items(*, lab_tests(name, unit, normal_range))').eq('patient_id', patient.id).order('ordered_at', { ascending: false }),
    supabase.from('invoices').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    supabase.from('admissions').select('*, beds(bed_no, wards(name)), doctors(full_name)').eq('patient_id', patient.id).order('admitted_at', { ascending: false }),
    supabase.from('patient_documents').select('*').eq('patient_id', patient.id).order('created_at', { ascending: false }),
    supabase.from('immunizations').select('*, vaccines(name)').eq('patient_id', patient.id).order('given_on', { ascending: false }),
  ]);

  return (
    <div>
      <Link href="/admin/patients" className="text-sm font-semibold text-brand-700">← All patients</Link>
      <PatientRecord
        role={profile?.role}
        patient={patient}
        appointments={appts.data || []}
        visits={visits.data || []}
        labs={labs.data || []}
        invoices={invoices.data || []}
        admissions={admissions.data || []}
        documents={docs.data || []}
        immunizations={imms.data || []}
      />
    </div>
  );
}
