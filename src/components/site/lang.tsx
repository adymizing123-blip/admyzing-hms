'use client';
import { createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { t, type Lang } from '@/lib/i18n';

const LangCtx = createContext<Lang>('en');

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);
export const useT = () => {
  const lang = useContext(LangCtx);
  return (key: string) => t(lang, key);
};

export function LangToggle({ className = '' }: { className?: string }) {
  const lang = useLang();
  const router = useRouter();
  const set = (l: Lang) => { document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`; router.refresh(); };
  return (
    <button onClick={() => set(lang === 'es' ? 'en' : 'es')} className={`inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold text-ink-soft hover:bg-slate-100 ${className}`} aria-label="Language / Idioma">
      <Languages size={18} /> {lang === 'es' ? 'EN' : 'ES'}
    </button>
  );
}
