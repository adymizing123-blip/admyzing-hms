import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_HOSPITAL } from './settings';
import { fmtWhen, messagingConfig, sendMessage } from './messaging';
import { sendInConversation } from './channels';
import { rxMessage, clinicInfo } from './rx-pad';
import { conditionsMatch, fill, pickChannel, staffChannel, SAMPLE_VARS, type Rule, type SendChannel } from './automation-core';
import { money } from './utils';

/**
 * Server-only automation engine.
 * The database queues jobs when things happen (booking, lead, chat message, lab result ...) and
 * automation_scan() queues date-based ones (birthdays, recalls, reminders). This sends the jobs that are due.
 * Called by /api/cron/automations (every 5-10 minutes), by the webhooks (instant chat replies) and by "Run now".
 */
type Shared = { tz: string; hospital: any; site: string; cfg: ReturnType<typeof messagingConfig> };
type Ctx = {
  vars: Record<string, string>;
  phone?: string | null; email?: string | null; name?: string | null; conversationId?: string | null;
  patientId?: string | null; leadId?: string | null; branchId?: string | null; source?: string | null;
  optOut?: boolean; first?: boolean; channelOverride?: string; templateOverride?: string | null;
  skip?: string; after?: () => Promise<unknown>;
};
type Outcome = { status: 'sent' | 'skipped' | 'failed'; channel?: string | null; recipient?: string | null; result?: string | null };

const MAX_ATTEMPTS = 3;

async function shared(db: any): Promise<Shared> {
  const { data: s } = await db.from('settings').select('value').eq('key', 'hospital').maybeSingle();
  const hospital = { ...DEFAULT_HOSPITAL, timezone: 'America/Chicago', ...(s?.value || {}) };
  return { tz: hospital.timezone, hospital, site: (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, ''), cfg: messagingConfig() };
}

function baseVars(sh: Shared, branch?: any): Record<string, string> {
  return {
    hospital: sh.hospital.name, phone: sh.hospital.phone,
    clinic: branch?.name || sh.hospital.name, clinic_address: branch?.address || sh.hospital.address || '', clinic_phone: branch?.phone || sh.hospital.phone,
    booking_link: `${sh.site}/book`, portal_link: `${sh.site}/portal`, admin_link: `${sh.site}/admin/crm`,
  };
}

const firstName = (s?: string | null) => (s || '').trim().split(/\s+/)[0] || 'there';
const full = (p: any) => (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '');
const label = (s?: string | null) => (s || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function patientCtx(p: any, sh: Shared, branch?: any): Ctx {
  return {
    vars: { ...baseVars(sh, branch), first_name: firstName(p?.first_name), patient: full(p) },
    phone: p?.phone, email: p?.email, name: full(p), patientId: p?.id, source: p?.source, optOut: !!p?.marketing_opt_out,
    branchId: branch?.id,
  };
}

const PATIENT = 'id, first_name, last_name, phone, email, source, marketing_opt_out';
const BRANCH = 'id, name, address, phone';

async function loadContext(db: any, job: any, rule: Rule, sh: Shared): Promise<Ctx> {
  const now = Date.now();
  switch (job.trigger) {
    case 'appointment_booked': case 'appointment_reminder': case 'appointment_completed': case 'appointment_no_show': case 'appointment_cancelled': {
      const { data: a } = await db.from('appointments')
        .select(`id, scheduled_at, status, token_no, visit_type, video_url, created_at, patients(${PATIENT}), doctors(full_name), branches(${BRANCH})`)
        .eq('id', job.entity_id).maybeSingle();
      if (!a) return { vars: {}, skip: 'Appointment deleted' };
      const ctx = patientCtx(a.patients, sh, a.branches);
      const when = fmtWhen(a.scheduled_at, sh.tz);
      Object.assign(ctx.vars, {
        doctor: a.doctors?.full_name || '', ...when, token: String(a.token_no ?? ''),
        visit: a.visit_type === 'video' ? 'video visit' : 'appointment',
        video: a.visit_type === 'video' && a.video_url ? ` Join here: ${a.video_url}` : '',
      });
      const at = new Date(a.scheduled_at).getTime();
      const want: Record<string, string> = { appointment_booked: 'booked', appointment_reminder: 'booked', appointment_completed: 'completed', appointment_no_show: 'no_show', appointment_cancelled: 'cancelled' };
      if (a.status !== want[job.trigger]) return { ...ctx, skip: `Appointment is ${label(a.status).toLowerCase()}` };
      if (job.trigger === 'appointment_booked' && at < now) return { ...ctx, skip: 'Appointment time has passed' };
      if (job.trigger === 'appointment_reminder') {
        if (job.meta?.scheduled_at && new Date(job.meta.scheduled_at).getTime() !== at) return { ...ctx, skip: 'Appointment was moved' };
        if (at <= now) return { ...ctx, skip: 'Appointment time has passed' };
        if (at - new Date(a.created_at).getTime() < Math.abs(rule.delay_minutes) * 60000) return { ...ctx, skip: 'Booked inside the reminder window (the confirmation covers it)' };
        ctx.after = () => db.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', a.id);
      }
      if (job.trigger === 'appointment_completed') {
        const { data: v } = await db.from('visits').select('id, diagnosis, advice, follow_up_date, created_at, prescriptions(medicine_name, dosage, frequency, duration, instructions)')
          .eq('appointment_id', a.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        ctx.vars.follow_up_date = v?.follow_up_date ? fmtWhen(`${v.follow_up_date}T12:00:00Z`, 'UTC').date : '';
        ctx.vars.prescription = v ? rxMessage({
          doctorName: a.doctors?.full_name || '', clinic: clinicInfo(a.branches), patient: { name: full(a.patients), date: when.date },
          diagnosis: v.diagnosis || '', advice: v.advice || '', items: v.prescriptions || [], followUp: ctx.vars.follow_up_date,
        }) : '';
        if (rule.template.includes('{prescription}') && !(v?.prescriptions || []).length) return { ...ctx, skip: 'No prescription written for this visit' };
      }
      return ctx;
    }

    case 'follow_up_visit': {
      const { data: v } = await db.from('visits').select(`id, patient_id, follow_up_date, patients(${PATIENT}), doctors(full_name), branches(${BRANCH})`).eq('id', job.entity_id).maybeSingle();
      if (!v) return { vars: {}, skip: 'Visit deleted' };
      const ctx = patientCtx(v.patients, sh, v.branches);
      Object.assign(ctx.vars, { doctor: v.doctors?.full_name || '', follow_up_date: fmtWhen(`${v.follow_up_date}T12:00:00Z`, 'UTC').date });
      if (v.follow_up_date !== job.meta?.follow_up_date) return { ...ctx, skip: 'Follow-up date was changed' };
      const until = new Date(`${v.follow_up_date}T00:00:00Z`); until.setUTCDate(until.getUTCDate() + 4);
      const { count } = await db.from('appointments').select('id', { count: 'exact', head: true })
        .eq('patient_id', v.patient_id).eq('status', 'booked').gte('scheduled_at', new Date().toISOString()).lt('scheduled_at', until.toISOString());
      if (count) return { ...ctx, skip: 'Follow-up already booked' };
      return ctx;
    }

    case 'lead_created': case 'lead_not_contacted': {
      const { data: l } = await db.from('leads').select(`id, name, phone, email, source, message, status, branches(${BRANCH})`).eq('id', job.entity_id).maybeSingle();
      if (!l) return { vars: {}, skip: 'Lead deleted' };
      const { data: conv } = await db.from('conversations').select('id').eq('lead_id', l.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      const ctx: Ctx = {
        vars: { ...baseVars(sh, l.branches), first_name: firstName(l.name), lead_name: l.name, lead_phone: l.phone || l.email || '-', source: label(l.source), message: l.message || '' },
        phone: l.phone, email: l.email, name: l.name, leadId: l.id, source: l.source, branchId: l.branches?.id, conversationId: conv?.id || null,
      };
      if (job.trigger === 'lead_not_contacted' && l.status !== 'new') return { ...ctx, skip: `Lead already ${l.status}` };
      return ctx;
    }

    case 'message_received': {
      const { data: m } = await db.from('conversation_messages').select('id, body, conversation_id').eq('id', job.entity_id).maybeSingle();
      if (!m) return { vars: {}, skip: 'Message deleted' };
      const { data: c } = await db.from('conversations')
        .select(`id, channel, contact_name, status, patients(${PATIENT}), leads(id, name, source), branches(${BRANCH})`).eq('id', m.conversation_id).single();
      const ctx: Ctx = {
        vars: { ...baseVars(sh, c.branches), first_name: firstName(c.patients?.first_name || c.contact_name || c.leads?.name), message: m.body || '', source: label(c.channel) },
        conversationId: c.id, patientId: c.patients?.id, leadId: c.leads?.id, branchId: c.branches?.id,
        source: c.patients?.source || c.leads?.source || c.channel, first: job.meta?.first !== false,
      };
      if (!job.meta?.first && rule.conditions?.first_message_only) return { ...ctx, skip: 'Not the first message' };
      const since = new Date(now - 10 * 60000).toISOString();
      const { count } = await db.from('conversation_messages').select('id', { count: 'exact', head: true })
        .eq('conversation_id', c.id).eq('direction', 'out').gte('created_at', since);
      if (count) return { ...ctx, skip: 'Already replied in the last 10 minutes' };
      return ctx;
    }

    case 'lab_result_ready': {
      const { data: o } = await db.from('lab_orders').select(`id, order_no, status, patients(${PATIENT}), branches(${BRANCH})`).eq('id', job.entity_id).maybeSingle();
      if (!o) return { vars: {}, skip: 'Lab order deleted' };
      const ctx = patientCtx(o.patients, sh, o.branches);
      ctx.vars.order_no = o.order_no;
      if (o.status !== 'completed') return { ...ctx, skip: 'Results not published' };
      return ctx;
    }

    case 'invoice_unpaid': {
      const { data: i } = await db.from('invoices').select(`id, invoice_no, status, total, amount_paid, patients(${PATIENT}), branches(${BRANCH})`).eq('id', job.entity_id).maybeSingle();
      if (!i) return { vars: {}, skip: 'Invoice deleted' };
      const ctx = patientCtx(i.patients, sh, i.branches);
      const due = Number(i.total || 0) - Number(i.amount_paid || 0);
      Object.assign(ctx.vars, { invoice_no: i.invoice_no, amount_due: money(due) });
      if (!['unpaid', 'partial'].includes(i.status) || due <= 0) return { ...ctx, skip: 'Bill is paid' };
      return ctx;
    }

    case 'birthday': case 'recall': {
      const { data: p } = await db.from('patients').select(`${PATIENT}, branches(${BRANCH})`).eq('id', job.entity_id).maybeSingle();
      if (!p) return { vars: {}, skip: 'Patient deleted' };
      const ctx = patientCtx(p, sh, p.branches);
      if (job.trigger === 'recall') {
        const { data: a } = await db.from('appointments').select('doctors(full_name)').eq('id', job.meta?.appointment_id).maybeSingle();
        ctx.vars.doctor = a?.doctors?.full_name || 'our doctor';
        const { count } = await db.from('appointments').select('id', { count: 'exact', head: true })
          .eq('patient_id', p.id).gt('scheduled_at', job.meta?.last_visit).neq('status', 'cancelled');
        if (count) return { ...ctx, skip: 'Patient has visited or booked since' };
      }
      return ctx;
    }

    case 'low_stock': {
      const { data: items } = await db.from('medicine_stock').select('name, stock, reorder_level').eq('active', true).order('stock').limit(200);
      const low = (items || []).filter((x: any) => x.stock <= x.reorder_level);
      const ctx: Ctx = { vars: { ...baseVars(sh), items: low.slice(0, 25).map((x: any) => `${x.name} (${x.stock} left)`).join(', ') + (low.length > 25 ? ` and ${low.length - 25} more` : '') } };
      if (!low.length) return { ...ctx, skip: 'Nothing is low on stock' };
      return ctx;
    }

    case 'crm_follow_up': {
      const { data: f } = await db.from('follow_ups').select(`id, status, channel, message, patients(${PATIENT}), leads(id, name, phone, email, source)`).eq('id', job.entity_id).maybeSingle();
      if (!f) return { vars: {}, skip: 'Follow-up deleted' };
      const ctx: Ctx = f.patients ? patientCtx(f.patients, sh) : {
        vars: { ...baseVars(sh), first_name: firstName(f.leads?.name) }, phone: f.leads?.phone, email: f.leads?.email, name: f.leads?.name, leadId: f.leads?.id, source: f.leads?.source,
      };
      ctx.channelOverride = f.channel;
      ctx.templateOverride = f.message || null;
      if (f.status !== 'pending') return { ...ctx, skip: `Follow-up already ${f.status}` };
      ctx.after = () => db.from('follow_ups').update({ status: 'done' }).eq('id', f.id);
      return ctx;
    }
  }
  return { vars: {}, skip: `Unknown trigger ${job.trigger}` };
}

async function deliver(rule: Rule, ctx: Ctx, sh: Shared): Promise<Outcome> {
  const isStaff = rule.channel === 'staff';
  const pick = isStaff ? staffChannel(rule.notify_to, sh.cfg)
    : pickChannel((ctx.channelOverride || rule.channel) as any, { conversationId: ctx.conversationId, phone: ctx.phone, email: ctx.email }, sh.cfg);
  if ('reason' in pick) return { status: 'skipped', result: pick.reason };
  const { channel, to } = pick;

  const body = fill(ctx.templateOverride || rule.template, ctx.vars);
  if (!body) return { status: 'skipped', result: 'Message is empty' };
  const subject = fill(rule.subject || `A message from ${sh.hospital.name}`, ctx.vars);
  const template = !isStaff && rule.wa_template
    ? { name: rule.wa_template, language: rule.wa_language || 'en', params: (rule.wa_params || '').split(',').map((k) => k.trim()).filter(Boolean).map((k) => ctx.vars[k] || '') }
    : null;

  let r: { status: string; error?: string | null };
  if (channel === 'conversation') {
    r = await sendInConversation(to, body, { automated: true, template, displayText: body });
  } else {
    r = await sendMessage({
      channel: channel as Exclude<SendChannel, 'conversation'>, to, body, subject, purpose: isStaff ? 'staff_alert' : 'automation',
      patient_id: isStaff ? null : ctx.patientId, lead_id: isStaff ? null : ctx.leadId, branch_id: ctx.branchId, name: isStaff ? null : ctx.name,
      automated: true, template,
    });
  }
  return { status: r.status as Outcome['status'], channel, recipient: channel === 'conversation' ? 'chat' : to, result: r.error || null };
}

async function processJob(db: any, job: any, sh: Shared): Promise<Outcome> {
  const rule = job.automations as Rule;
  if (!rule) return { status: 'skipped', result: 'Rule deleted' };
  if (!rule.enabled) return { status: 'skipped', result: 'Rule is switched off' };
  const ctx = await loadContext(db, job, rule, sh);
  if (ctx.skip) return { status: 'skipped', result: ctx.skip };
  const cond = conditionsMatch(rule.conditions, { branchId: ctx.branchId || job.branch_id, source: ctx.source, first: ctx.first, tz: sh.tz });
  if ('reason' in cond) return { status: 'skipped', result: cond.reason };
  if (rule.marketing && ctx.optOut) return { status: 'skipped', result: 'Patient opted out of marketing messages' };
  const out = await deliver(rule, ctx, sh);
  if (out.status === 'sent' && ctx.after) await ctx.after();
  return out;
}

export async function runAutomations(opts: { scan?: boolean; limit?: number; conversationId?: string } = {}) {
  const db = createAdminClient();
  let scanned = 0;
  if (opts.scan !== false) {
    const { data, error } = await db.rpc('automation_scan');
    if (error) throw new Error(error.message);
    scanned = data || 0;
  }
  let q = db.from('automation_jobs').select('*, automations(*)').eq('status', 'pending').lte('run_at', new Date().toISOString())
    .order('run_at').limit(opts.limit || 100);
  if (opts.conversationId) q = q.eq('conversation_id', opts.conversationId);
  const { data: jobs, error } = await q;
  if (error) throw new Error(error.message);

  // after-hours reply goes before the general auto-reply, so one message gets one reply
  const list = (jobs || []).sort((a: any, b: any) =>
    a.run_at === b.run_at ? Number(!!b.automations?.conditions?.outside_hours) - Number(!!a.automations?.conditions?.outside_hours) : 0);

  const sh = await shared(db);
  const totals = { scanned, processed: 0, sent: 0, skipped: 0, failed: 0 };
  for (const job of list) {
    // claim the job so two runs at the same time never send it twice
    const { data: claimed } = await db.from('automation_jobs').update({ attempts: job.attempts + 1 }).eq('id', job.id).eq('status', 'pending').eq('attempts', job.attempts).select('id');
    if (!claimed?.length) continue;
    let out: Outcome;
    try { out = await processJob(db, job, sh); } catch (e: any) { out = { status: 'failed', result: e.message }; }
    totals.processed++;
    const retry = out.status === 'failed' && job.attempts + 1 < MAX_ATTEMPTS;
    await db.from('automation_jobs').update({
      status: retry ? 'pending' : out.status, channel: out.channel || null, recipient: out.recipient || null, result: out.result || null,
      processed_at: new Date().toISOString(), ...(retry ? { run_at: new Date(Date.now() + 15 * 60000 * (job.attempts + 1)).toISOString() } : {}),
    }).eq('id', job.id);
    if (out.status === 'sent') {
      totals.sent++;
      await db.from('automations').update({ run_count: (job.automations?.run_count || 0) + 1, last_run_at: new Date().toISOString() }).eq('id', job.automation_id);
      if (job.automations) job.automations.run_count = (job.automations.run_count || 0) + 1;
    } else if (out.status === 'skipped') totals.skipped++;
    else totals.failed++;
  }
  return totals;
}

/** "Send test" on the Automations screen: the message with sample values, to the phone or email typed. */
export async function testAutomation(rule: Rule, to: string, sentBy: string) {
  const db = createAdminClient();
  const sh = await shared(db);
  const vars = { ...SAMPLE_VARS, ...baseVars(sh) , first_name: SAMPLE_VARS.first_name };
  const ch = to.includes('@') ? 'email' : rule.channel === 'sms' ? 'sms' : sh.cfg.whatsapp && rule.channel !== 'email' ? 'whatsapp' : 'sms';
  const template = ch === 'whatsapp' && rule.wa_template
    ? { name: rule.wa_template, language: rule.wa_language || 'en', params: (rule.wa_params || '').split(',').map((k) => k.trim()).filter(Boolean).map((k) => (vars as any)[k] || '') }
    : null;
  return sendMessage({
    channel: ch as any, to, body: `[TEST] ${fill(rule.template, vars)}`, subject: `[TEST] ${fill(rule.subject || rule.name, vars)}`,
    purpose: 'automation_test', sent_by: sentBy, template,
  });
}
