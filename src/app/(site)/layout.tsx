import Header from '@/components/site/Header';
import Footer from '@/components/site/Footer';
import { CartProvider } from '@/components/site/cart';
import { createClient } from '@/lib/supabase/server';
import { getHospital } from '@/lib/settings';
import SourceTracker from '@/components/site/SourceTracker';

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const h = await getHospital(supabase);
  return (
    <CartProvider>
      <SourceTracker />
      <Header signedIn={!!user} phone={h.phone} />
      <main>{children}</main>
      <Footer h={h} />
    </CartProvider>
  );
}
