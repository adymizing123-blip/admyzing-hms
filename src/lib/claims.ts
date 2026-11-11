/** Builds a clearinghouse-friendly claim payload (CMS-1500 / 837P fields) from our records. */
export function buildClaim(claim: any, hospital: any) {
  const inv = claim.invoices;
  const p = inv?.patients || {};
  const [addr1, city, stateZip] = String(p.address ? `${p.address}, ${p.city || ''}, ${p.state || ''} ${p.zip || ''}` : '').split(',').map((x) => x?.trim());
  const dx = String(claim.diagnosis_codes || '').split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
  const serviceDate = (inv?.created_at || new Date().toISOString()).slice(0, 10);
  return {
    claim_reference: claim.id,
    invoice_number: inv?.invoice_no,
    claim_type: 'professional',
    payer: { name: claim.provider, payer_id: claim.payer_id || null },
    billing_provider: { name: hospital.name, npi: hospital.npi || null, tax_id: hospital.tax_id || null, address: hospital.address, phone: hospital.phone },
    subscriber: {
      member_id: claim.member_id || p.insurance_member_id || null,
      first_name: p.first_name, last_name: p.last_name, date_of_birth: p.dob ? String(p.dob).slice(0, 10) : null,
      gender: p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'U',
      address: { line1: addr1 || null, city: p.city || city || null, state: p.state || null, zip: p.zip || stateZip || null },
      relationship_to_patient: 'self',
    },
    diagnosis_codes: dx,
    service_lines: (inv?.invoice_items || []).filter((i: any) => Number(i.line_total) > 0).map((i: any, n: number) => ({
      line: n + 1,
      service_date: serviceDate,
      procedure_code: i.code || null,
      description: i.description,
      units: Number(i.quantity),
      charge: Number(i.line_total),
      diagnosis_pointers: dx.length ? [1] : [],
      place_of_service: i.category === 'room' ? '21' : '22',
    })),
    total_charge: Number(claim.amount),
    created_at: claim.created_at,
  };
}

export function claimProblems(c: ReturnType<typeof buildClaim>) {
  const issues: string[] = [];
  if (!c.billing_provider.npi) issues.push('Hospital NPI is missing (Settings > Hospital).');
  if (!c.billing_provider.tax_id) issues.push('Hospital Tax ID is missing (Settings > Hospital).');
  if (!c.payer.payer_id) issues.push('Payer ID is missing.');
  if (!c.subscriber.member_id) issues.push('Member ID is missing.');
  if (!c.subscriber.date_of_birth) issues.push('Patient date of birth is missing.');
  if (!c.diagnosis_codes.length) issues.push('At least one ICD-10 diagnosis code is required.');
  if (c.service_lines.some((l: any) => !l.procedure_code)) issues.push('Every service line needs a CPT/HCPCS code.');
  return issues;
}
