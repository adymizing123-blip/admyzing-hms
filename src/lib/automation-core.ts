/**
 * Automation rules: shared by the engine (server) and the Automations screen (browser). No server imports here.
 */
export type Trigger =
  | 'appointment_booked' | 'appointment_reminder' | 'appointment_completed' | 'appointment_no_show' | 'appointment_cancelled'
  | 'follow_up_visit' | 'lead_created' | 'lead_not_contacted' | 'message_received' | 'lab_result_ready' | 'invoice_unpaid'
  | 'birthday' | 'recall' | 'low_stock' | 'crm_follow_up';

export type RuleChannel = 'auto' | 'whatsapp' | 'sms' | 'email' | 'staff';
export type SendChannel = 'conversation' | 'whatsapp' | 'sms' | 'email';

export type Conditions = {
  branch_id?: string | null;
  sources?: string[];
  exclude_sources?: string[];
  first_message_only?: boolean;
  outside_hours?: { start: string; end: string } | null;
  days?: number;
};

export type Rule = {
  id?: string; key?: string | null; name: string; description?: string | null; trigger: Trigger; enabled: boolean;
  channel: RuleChannel; delay_minutes: number; conditions: Conditions; subject?: string | null; template: string;
  wa_template?: string | null; wa_language?: string | null; wa_params?: string | null; notify_to?: string | null; marketing?: boolean;
  run_count?: number; last_run_at?: string | null;
};

export const CATEGORIES = ['Appointments', 'Leads & chats', 'Patient care', 'Billing', 'Marketing', 'Staff alerts'] as const;

const APPT_VARS = ['first_name', 'patient', 'doctor', 'clinic', 'clinic_address', 'clinic_phone', 'date', 'time', 'token', 'visit', 'video', 'booking_link', 'hospital', 'phone'];

export const TRIGGERS: Record<Trigger, { label: string; category: (typeof CATEGORIES)[number]; event: string; timing: 'before' | 'after'; vars: string[] }> = {
  appointment_booked: { label: 'Appointment booked', category: 'Appointments', event: 'the booking', timing: 'after', vars: APPT_VARS },
  appointment_reminder: { label: 'Before the appointment', category: 'Appointments', event: 'the appointment', timing: 'before', vars: APPT_VARS },
  appointment_completed: { label: 'Visit completed', category: 'Appointments', event: 'the visit', timing: 'after', vars: [...APPT_VARS, 'prescription', 'follow_up_date'] },
  appointment_no_show: { label: 'Patient did not come', category: 'Appointments', event: 'marking no-show', timing: 'after', vars: APPT_VARS },
  appointment_cancelled: { label: 'Appointment cancelled', category: 'Appointments', event: 'the cancellation', timing: 'after', vars: APPT_VARS },
  follow_up_visit: { label: 'Follow-up date set by doctor', category: 'Patient care', event: 'the follow-up date (9 AM)', timing: 'before', vars: ['first_name', 'patient', 'doctor', 'clinic', 'clinic_phone', 'follow_up_date', 'booking_link', 'hospital'] },
  lead_created: { label: 'New lead', category: 'Leads & chats', event: 'the lead arrives', timing: 'after', vars: ['first_name', 'lead_name', 'lead_phone', 'source', 'message', 'clinic', 'booking_link', 'hospital', 'admin_link'] },
  lead_not_contacted: { label: 'Lead still not contacted', category: 'Leads & chats', event: 'the lead arrives', timing: 'after', vars: ['lead_name', 'lead_phone', 'source', 'message', 'clinic', 'admin_link'] },
  message_received: { label: 'Chat message received', category: 'Leads & chats', event: 'the message', timing: 'after', vars: ['first_name', 'clinic', 'message', 'source', 'booking_link', 'hospital'] },
  lab_result_ready: { label: 'Lab results published', category: 'Patient care', event: 'publishing', timing: 'after', vars: ['first_name', 'patient', 'order_no', 'clinic', 'portal_link', 'hospital'] },
  invoice_unpaid: { label: 'Bill still unpaid', category: 'Billing', event: 'the bill', timing: 'after', vars: ['first_name', 'invoice_no', 'amount_due', 'portal_link', 'hospital', 'phone'] },
  birthday: { label: 'Patient birthday', category: 'Marketing', event: '9 AM on the birthday', timing: 'after', vars: ['first_name', 'patient', 'clinic', 'hospital'] },
  recall: { label: 'Not seen for a while', category: 'Marketing', event: 'the day it is due', timing: 'after', vars: ['first_name', 'doctor', 'clinic', 'booking_link', 'hospital'] },
  low_stock: { label: 'Medicines low on stock', category: 'Staff alerts', event: '9 AM', timing: 'after', vars: ['items', 'hospital'] },
  crm_follow_up: { label: 'CRM follow-up due', category: 'Leads & chats', event: 'the due date', timing: 'after', vars: ['first_name', 'hospital', 'phone'] },
};

export const VAR_HELP: Record<string, string> = {
  first_name: 'First name', patient: 'Full name', doctor: 'Doctor', clinic: 'Clinic name', clinic_address: 'Clinic address',
  clinic_phone: 'Clinic phone', date: 'Date', time: 'Time', token: 'Token no.', visit: '"appointment" or "video visit"',
  video: 'Video link line', booking_link: 'Online booking link', portal_link: 'Patient portal link', hospital: 'Hospital name',
  phone: 'Hospital phone', prescription: 'Prescription text', follow_up_date: 'Follow-up date', lead_name: 'Lead name',
  lead_phone: 'Lead phone', source: 'Source / channel', message: 'Their message', order_no: 'Lab order no.',
  invoice_no: 'Invoice no.', amount_due: 'Balance due', items: 'Low-stock list', admin_link: 'CRM link',
};

export const SAMPLE_VARS: Record<string, string> = {
  first_name: 'Ayesha', patient: 'Ayesha Khan', doctor: 'Dr. Salman', clinic: 'Gulberg Clinic', clinic_address: '12 Main Boulevard',
  clinic_phone: '0300 1234567', date: 'Wed, Nov 12', time: '6:00 PM', token: '7', visit: 'appointment', video: '',
  booking_link: 'https://yourclinic.com/book', portal_link: 'https://yourclinic.com/portal', hospital: 'CarePlus', phone: '0300 1234567',
  prescription: '1. Paracetamol 500mg - 1 tab, twice daily, 3 days', follow_up_date: 'Wed, Nov 19', lead_name: 'Ayesha Khan',
  lead_phone: '+923001112222', source: 'Instagram', message: 'Price for laser?', order_no: 'LAB-2001', invoice_no: 'INV-1042',
  amount_due: '$45.00', items: 'Amoxicillin (4 left), Ibuprofen (2 left)', admin_link: 'https://yourclinic.com/admin/crm',
};

export const SOURCES = ['website', 'facebook', 'instagram', 'whatsapp', 'google', 'phone', 'walk_in', 'referral', 'other'];

/** Replaces {first_name}, {doctor} ... Unknown placeholders become blank. */
export function fill(template: string, vars: Record<string, string | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '').replace(/[ \t]+\n/g, '\n').trim();
}

/** Is `now` inside opening hours (HH:MM, in the given time zone)? Handles hours past midnight, e.g. 18:00 to 02:00. */
export function inHours(now: Date, tz: string, start: string, end: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const cur = h * 60 + m;
  const toMin = (s: string) => { const [a, b] = s.split(':').map(Number); return (a || 0) * 60 + (b || 0); };
  const s = toMin(start), e = toMin(end);
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

export function conditionsMatch(c: Conditions | null | undefined, ctx: { branchId?: string | null; source?: string | null; first?: boolean; now?: Date; tz?: string }):
  { ok: true } | { ok: false; reason: string } {
  const cond = c || {};
  if (cond.branch_id && cond.branch_id !== ctx.branchId) return { ok: false, reason: 'Different clinic' };
  const src = ctx.source || 'unknown';
  if (cond.sources?.length && !cond.sources.includes(src)) return { ok: false, reason: `Source is ${src}` };
  if (cond.exclude_sources?.length && cond.exclude_sources.includes(src)) return { ok: false, reason: `Source is ${src}` };
  if (cond.first_message_only && ctx.first === false) return { ok: false, reason: 'Not the first message' };
  if (cond.outside_hours?.start && cond.outside_hours?.end
      && inHours(ctx.now || new Date(), ctx.tz || 'UTC', cond.outside_hours.start, cond.outside_hours.end)) return { ok: false, reason: 'Clinic is open' };
  return { ok: true };
}

export type ChannelConfig = { sms: boolean; whatsapp: boolean; email: boolean };

/** Which channel to use for one person. "auto": reply in their chat, else WhatsApp, else SMS, else email. */
export function pickChannel(rule: RuleChannel | 'call', who: { conversationId?: string | null; phone?: string | null; email?: string | null }, cfg: ChannelConfig):
  { channel: SendChannel; to: string } | { channel: null; reason: string } {
  if (rule === 'auto') {
    if (who.conversationId) return { channel: 'conversation', to: who.conversationId };
    if (who.phone && cfg.whatsapp) return { channel: 'whatsapp', to: who.phone };
    if (who.phone && cfg.sms) return { channel: 'sms', to: who.phone };
    if (who.email && cfg.email) return { channel: 'email', to: who.email };
    if (!who.phone && !who.email) return { channel: null, reason: 'No phone, email or chat' };
    return { channel: null, reason: 'No messaging service is set up (WhatsApp, SMS or email)' };
  }
  if (rule === 'whatsapp' || rule === 'sms') {
    if (rule === 'whatsapp' && who.conversationId && !who.phone) return { channel: 'conversation', to: who.conversationId };
    if (!who.phone) return { channel: null, reason: 'No phone number' };
    if (!cfg[rule]) return { channel: null, reason: `${rule === 'sms' ? 'SMS' : 'WhatsApp'} is not set up` };
    return { channel: rule, to: who.phone };
  }
  if (rule === 'email') {
    if (!who.email) return { channel: null, reason: 'No email address' };
    if (!cfg.email) return { channel: null, reason: 'Email is not set up' };
    return { channel: 'email', to: who.email };
  }
  return { channel: null, reason: 'Phone call follow-ups are not sent automatically' };
}

/** Staff alerts go to notify_to: an email address, or a phone (WhatsApp first, then SMS). */
export function staffChannel(notifyTo: string | null | undefined, cfg: ChannelConfig): { channel: SendChannel; to: string } | { channel: null; reason: string } {
  const to = (notifyTo || '').split(',')[0].trim();
  if (!to) return { channel: null, reason: 'Add the staff phone or email to notify' };
  if (to.includes('@')) return cfg.email ? { channel: 'email', to } : { channel: null, reason: 'Email is not set up' };
  if (cfg.whatsapp) return { channel: 'whatsapp', to };
  if (cfg.sms) return { channel: 'sms', to };
  return { channel: null, reason: 'WhatsApp or SMS is not set up' };
}

export function fmtDuration(mins: number) {
  const m = Math.abs(mins);
  if (m === 0) return '';
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'}`;
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'}`;
  return `${m} min`;
}

/** "1 day before the appointment", "Right after the booking", "2 hours after the visit" */
export function describeTiming(trigger: Trigger, delay: number) {
  const t = TRIGGERS[trigger];
  if (!delay) return `Right at ${t.event}`;
  return `${fmtDuration(delay)} ${delay < 0 ? 'before' : 'after'} ${t.event}`;
}

export function ruleCategory(r: Pick<Rule, 'trigger' | 'channel'>) {
  return r.channel === 'staff' ? 'Staff alerts' : TRIGGERS[r.trigger]?.category || 'Appointments';
}

export const CHANNEL_LABEL: Record<string, string> = {
  auto: 'Best available', whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', staff: 'Staff alert', conversation: 'Chat reply',
  facebook: 'Facebook', instagram: 'Instagram',
};
