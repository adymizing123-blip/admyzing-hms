export const DEFAULT_HOSPITAL = {
  name: 'CarePlus Hospital',
  phone: '(555) 010-2000',
  email: 'hello@careplus.example',
  address: '1200 Wellness Ave, Austin, TX 78701',
  tax_rate: 8.25,
  currency: 'USD',
};

export async function getHospital(supabase: any) {
  const { data } = await supabase.from('settings').select('value').eq('key', 'hospital').maybeSingle();
  return { ...DEFAULT_HOSPITAL, ...(data?.value || {}) };
}
