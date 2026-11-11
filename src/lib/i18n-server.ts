import { cookies } from 'next/headers';
import { t, type Lang } from './i18n';

export function getLang(): Lang {
  return cookies().get('lang')?.value === 'es' ? 'es' : 'en';
}

/** Server components: const tr = getT(); tr('Book Appointment') */
export function getT() {
  const lang = getLang();
  return (key: string) => t(lang, key);
}
