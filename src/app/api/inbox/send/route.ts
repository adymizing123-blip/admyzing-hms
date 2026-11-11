import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/staff-auth';
import { sendInConversation } from '@/lib/channels';

/** Reply in a chat: { conversation_id, body, template?: { name, language, params } } */
export async function POST(req: Request) {
  const me = await requireRole(['receptionist', 'doctor', 'nurse']);
  if (!me) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const b = await req.json();
  if (!b.conversation_id) return NextResponse.json({ error: 'No chat selected' }, { status: 400 });
  const template = b.template?.name ? { name: String(b.template.name), language: b.template.language || 'en', params: (b.template.params || []).map(String) } : null;
  const r = await sendInConversation(b.conversation_id, String(b.body || ''), { sent_by: me.id, template });
  return NextResponse.json(r, { status: r.status === 'sent' ? 200 : 400 });
}
