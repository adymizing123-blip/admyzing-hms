import type { Metadata, Viewport } from 'next';
import './globals.css';
import { LangProvider } from '@/components/site/lang';
import { getLang } from '@/lib/i18n-server';

export const metadata: Metadata = {
  title: { default: 'CarePlus Hospital', template: '%s | CarePlus Hospital' },
  description: 'Compassionate, modern healthcare. Book appointments, shop health products and access your records online.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#059677' };

// All pages read live data from Supabase
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLang();
  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen font-sans"><LangProvider lang={lang}>{children}</LangProvider></body>
    </html>
  );
}
