import { requireRole } from '@/lib/staff-auth';
import { waMediaUrl } from '@/lib/channels';

export const dynamic = 'force-dynamic';

/** Opens a WhatsApp image / voice note / document for signed-in staff (WhatsApp media links need the Meta token). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requireRole(['receptionist', 'doctor', 'nurse']))) return new Response('Not allowed', { status: 403 });
  try {
    const m = await waMediaUrl(params.id);
    const file = await fetch(m.url, { headers: { Authorization: `Bearer ${m.token}` } });
    if (!file.ok) return new Response('Media not available', { status: 404 });
    return new Response(file.body, { headers: { 'Content-Type': m.mime || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' } });
  } catch (e: any) {
    return new Response(e.message, { status: 404 });
  }
}
