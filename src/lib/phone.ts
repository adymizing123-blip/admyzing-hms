/**
 * Phone numbers -> E.164 ("+923001234567"). Safe to use in the browser and on the server.
 *  - "+..." is kept as it is
 *  - "0300 1234567" (a leading 0, local format) -> +<country code> + the rest. Country code comes from
 *    NEXT_PUBLIC_DEFAULT_COUNTRY_CODE (default 92 = Pakistan)
 *  - 10 digits -> +1 (US), 11 digits starting with 1 -> +1...
 */
export function toE164(phone?: string | null) {
  if (!phone) return null;
  const t = phone.trim();
  if (t.startsWith('+')) return '+' + t.slice(1).replace(/\D/g, '');
  let d = t.replace(/\D/g, '');
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.startsWith('0') && d.length >= 10 && d.length <= 12) return `+${process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || '92'}${d.slice(1)}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

/** Link that opens WhatsApp with the message ready to send (works without any API keys). */
export function whatsappLink(phone: string | null | undefined, text: string) {
  const e = toE164(phone);
  return `https://wa.me/${e ? e.slice(1) : ''}?text=${encodeURIComponent(text)}`;
}
