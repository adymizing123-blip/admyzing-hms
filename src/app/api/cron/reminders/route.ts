import { GET as runAll } from '../automations/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Kept so existing cron settings keep working. Appointment reminders and CRM follow-ups are now
 * automation rules (Admin > Automations), sent by /api/cron/automations.
 */
export function GET(req: Request) {
  return runAll(req);
}
