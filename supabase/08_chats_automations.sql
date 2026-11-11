-- =====================================================================
-- 08: Where patients come from (lead source + clinic), one inbox for
--     WhatsApp / Facebook / Instagram / SMS chats, and automations.
-- Run after 07_doctor_clinics.sql. Safe to run more than once.
-- =====================================================================

-- digits only, last 10: "+92 300 1234567" and "0300-1234567" give the same key
create or replace function phone_key(p text) returns text
language sql immutable as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '')
$$;

create or replace function hospital_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value->>'timezone' from settings where key = 'hospital'), 'America/Chicago')
$$;

-- =====================================================================
-- 1. Lead source and clinic on patients and leads
-- =====================================================================
-- source: website, facebook, instagram, whatsapp, google, phone, walk_in, referral, other
alter table patients add column if not exists source text;
alter table patients add column if not exists source_detail text;          -- ad / campaign name
alter table patients add column if not exists branch_id uuid references branches(id) on delete set null;  -- first clinic
alter table patients add column if not exists lead_id uuid references leads(id) on delete set null;
create index if not exists patients_source_idx on patients(source);
create index if not exists patients_branch_idx on patients(branch_id);
create index if not exists patients_phone_key_idx on patients(phone_key(phone));

alter table leads add column if not exists branch_id uuid references branches(id) on delete set null;
alter table leads add column if not exists source_detail text;
alter table leads add column if not exists patient_id uuid references patients(id) on delete set null;
alter table leads add column if not exists converted_at timestamptz;
create index if not exists leads_source_idx on leads(source);
create index if not exists leads_branch_idx on leads(branch_id);
create index if not exists leads_phone_key_idx on leads(phone_key(phone));

alter table appointments drop constraint if exists appointments_source_check;
alter table appointments add constraint appointments_source_check
  check (source in ('web','walk_in','phone','portal','facebook','instagram','whatsapp','google','referral','other'));

create or replace function appt_to_patient_source(s text) returns text
language sql immutable as $$ select case s when 'web' then 'website' when 'portal' then 'website' else s end $$;

-- backfill from each patient's first appointment
update patients p set branch_id = x.branch_id
  from (select distinct on (patient_id) patient_id, branch_id from appointments where branch_id is not null order by patient_id, scheduled_at) x
 where x.patient_id = p.id and p.branch_id is null;
update patients p set source = appt_to_patient_source(x.source)
  from (select distinct on (patient_id) patient_id, source from appointments order by patient_id, created_at) x
 where x.patient_id = p.id and p.source is null;

-- a new patient whose phone or email matches an open lead is that lead: keep its source and clinic
create or replace function trg_patient_from_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if new.lead_id is null and (phone_key(new.phone) is not null or new.email is not null) then
    select * into l from leads
     where status <> 'converted' and patient_id is null and created_at > now() - interval '365 days'
       and ((phone_key(new.phone) is not null and phone_key(phone) = phone_key(new.phone))
         or (new.email is not null and lower(email) = lower(new.email)))
     order by created_at desc limit 1;
    if found then new.lead_id := l.id; end if;
  end if;
  if new.lead_id is not null then
    select * into l from leads where id = new.lead_id;
    new.source := coalesce(new.source, l.source);
    new.source_detail := coalesce(new.source_detail, l.source_detail);
    new.branch_id := coalesce(new.branch_id, l.branch_id);
  end if;
  return new;
end $$;
drop trigger if exists patient_from_lead on patients;
create trigger patient_from_lead before insert on patients for each row execute function trg_patient_from_lead();

create or replace function trg_patient_link_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update leads set status = 'converted', patient_id = new.id, converted_at = coalesce(converted_at, now())
   where id = new.lead_id and patient_id is null;
  update conversations set patient_id = new.id where lead_id = new.lead_id and patient_id is null;
  return null;
end $$;

-- the first appointment stamps the patient's clinic and (if unknown) source
create or replace function trg_patient_first_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update patients set branch_id = coalesce(branch_id, new.branch_id), source = coalesce(source, appt_to_patient_source(new.source))
   where id = new.patient_id and (branch_id is null or source is null);
  return null;
end $$;
drop trigger if exists patient_first_touch on appointments;
create trigger patient_first_touch after insert on appointments for each row execute function trg_patient_first_touch();

-- website booking remembers where the visitor came from (?utm_source=facebook ...)
drop function if exists book_appointment(uuid, timestamptz, text, text, text, text, date, text, text);
create or replace function book_appointment(
  p_doctor_id uuid,
  p_scheduled_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_dob date default null,
  p_reason text default null,
  p_visit_type text default 'in_person',
  p_source text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid; v_token int; v_appt uuid; v_url text;
  v_source text := case when p_source in ('facebook','instagram','whatsapp','google','referral') then p_source else 'web' end;
begin
  if p_scheduled_at < now() then raise exception 'Please choose a future time slot'; end if;
  if not exists (select 1 from doctors where id = p_doctor_id and active) then raise exception 'Doctor not available'; end if;

  v_patient := my_patient_id();
  if v_patient is not null then
    v_source := 'portal';
  else
    select id into v_patient from patients
     where (p_email is not null and lower(email) = lower(p_email))
        or (phone_key(p_phone) is not null and phone_key(phone) = phone_key(p_phone))
     order by created_at limit 1;
  end if;
  if v_patient is null then
    insert into patients (first_name, last_name, phone, email, dob, source)
    values (p_first_name, p_last_name, p_phone, p_email, p_dob, appt_to_patient_source(v_source)) returning id into v_patient;
  end if;

  if exists (select 1 from appointments where doctor_id = p_doctor_id
             and scheduled_at = p_scheduled_at and status not in ('cancelled','no_show')) then
    raise exception 'This slot was just booked. Please pick another time.';
  end if;

  select coalesce(max(token_no), 0) + 1 into v_token from appointments
   where doctor_id = p_doctor_id and scheduled_at::date = p_scheduled_at::date;

  insert into appointments (patient_id, doctor_id, scheduled_at, token_no, reason, source, visit_type)
  values (v_patient, p_doctor_id, p_scheduled_at, v_token, p_reason, v_source, coalesce(p_visit_type, 'in_person'))
  returning id, video_url into v_appt, v_url;

  return json_build_object('appointment_id', v_appt, 'token_no', v_token, 'video_url', v_url);
end $$;
grant execute on function book_appointment(uuid, timestamptz, text, text, text, text, date, text, text, text) to anon, authenticated;

-- =====================================================================
-- 2. Chats: WhatsApp, Facebook Messenger, Instagram DM, SMS in one inbox
-- =====================================================================
-- Each WhatsApp number / Facebook page / Instagram account belongs to a clinic,
-- so a chat is tagged with the clinic automatically.
create table if not exists channel_accounts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','facebook','instagram','sms')),
  provider text not null default 'meta' check (provider in ('meta','twilio')),
  account_id text not null,      -- WhatsApp phone number ID, Facebook Page ID, Instagram account ID, or the Twilio number
  page_id text,                  -- Instagram only: the Facebook Page linked to the Instagram account (used to reply)
  name text not null,
  branch_id uuid references branches(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (channel, account_id)
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','facebook','instagram','sms')),
  account_id uuid references channel_accounts(id) on delete set null,
  external_id text not null,     -- phone (+923001234567) for WhatsApp/SMS, sender ID for Facebook/Instagram
  contact_name text,
  patient_id uuid references patients(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  assigned_to uuid references profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open','closed')),
  unread int not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz,
  ad_referral jsonb,             -- click-to-WhatsApp / Messenger ad that started the chat
  created_at timestamptz not null default now()
);
create unique index if not exists conversations_unique on conversations (channel, coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid), external_id);
create index if not exists conversations_last_idx on conversations(last_message_at desc nulls last);
create index if not exists conversations_patient_idx on conversations(patient_id);
create index if not exists conversations_lead_idx on conversations(lead_id);

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  body text,
  media_type text,               -- image, video, audio, document, sticker, location
  media_url text,                -- link, or "wa:<media id>" for WhatsApp media (opened through /api/inbox/media)
  provider_message_id text,
  status text not null default 'received' check (status in ('received','sent','delivered','read','failed')),
  error text,
  sent_by uuid references profiles(id) on delete set null,
  automated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists conversation_messages_idx on conversation_messages(conversation_id, created_at);
create unique index if not exists conversation_messages_provider_idx on conversation_messages(provider_message_id) where provider_message_id is not null;

-- now that conversations exists, link a converted patient's chats
drop trigger if exists patient_link_lead on patients;
create trigger patient_link_lead after insert on patients for each row when (new.lead_id is not null) execute function trg_patient_link_lead();

create or replace function trg_conversation_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update conversations set
    last_message_at = new.created_at,
    last_message_preview = left(coalesce(nullif(new.body, ''), '[' || coalesce(new.media_type, 'attachment') || ']'), 140),
    unread = case when new.direction = 'in' then unread + 1 else unread end,
    last_inbound_at = case when new.direction = 'in' then new.created_at else last_inbound_at end,
    status = case when new.direction = 'in' then 'open' else status end
  where id = new.conversation_id;
  return null;
end $$;
drop trigger if exists conversation_touch on conversation_messages;
create trigger conversation_touch after insert on conversation_messages for each row execute function trg_conversation_touch();

-- find or start the chat with one person on one channel
create or replace function inbox_conversation(p_channel text, p_account uuid, p_external text, p_name text default null,
  p_patient uuid default null, p_lead uuid default null, p_branch uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from conversations
   where channel = p_channel and external_id = p_external
     and coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_account, '00000000-0000-0000-0000-000000000000'::uuid);
  if v is null then
    insert into conversations (channel, account_id, external_id, contact_name, patient_id, lead_id, branch_id)
    values (p_channel, p_account, p_external, p_name, p_patient, p_lead,
            coalesce(p_branch, (select branch_id from channel_accounts where id = p_account)))
    returning id into v;
  else
    update conversations set
      patient_id = coalesce(patient_id, p_patient), lead_id = coalesce(lead_id, p_lead),
      contact_name = coalesce(contact_name, p_name)
    where id = v;
  end if;
  return v;
end $$;

-- An incoming chat message (called by the webhooks with the service key).
-- Matches the sender to a patient by phone, otherwise opens a lead with the channel as its source.
create or replace function inbox_receive(
  p_channel text, p_account_id text, p_external text, p_name text, p_body text,
  p_media_type text default null, p_media_url text default null, p_provider_id text default null,
  p_referral jsonb default null, p_direction text default 'in', p_at timestamptz default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  acc channel_accounts; conv conversations; v_conv uuid; v_patient uuid; v_lead uuid; v_msg uuid; v_new boolean := false;
  v_detail text := nullif(coalesce(p_referral->>'headline', p_referral->>'ad_title', p_referral->>'source_url', p_referral->>'ref'), '');
begin
  if p_provider_id is not null and exists (select 1 from conversation_messages where provider_message_id = p_provider_id) then
    return json_build_object('duplicate', true);
  end if;
  select * into acc from channel_accounts where channel = p_channel and account_id = p_account_id;

  select * into conv from conversations
   where channel = p_channel and external_id = p_external
     and coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(acc.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if conv.id is null then
    v_new := true;
    if p_channel in ('whatsapp','sms') and phone_key(p_external) is not null then
      select id into v_patient from patients where phone_key(phone) = phone_key(p_external) order by created_at limit 1;
      if v_patient is null then
        select id into v_lead from leads where phone_key(phone) = phone_key(p_external) and status <> 'converted' order by created_at desc limit 1;
      end if;
    end if;
    if v_patient is null and v_lead is null and p_direction = 'in' then
      insert into leads (name, phone, source, source_detail, message, status, branch_id)
      values (coalesce(nullif(trim(p_name), ''), p_external), case when p_channel in ('whatsapp','sms') then p_external end,
              p_channel, v_detail, left(p_body, 500), 'new', acc.branch_id)
      returning id into v_lead;
    end if;
    insert into conversations (channel, account_id, external_id, contact_name, patient_id, lead_id, branch_id, ad_referral)
    values (p_channel, acc.id, p_external, nullif(trim(p_name), ''), v_patient, v_lead, acc.branch_id, p_referral)
    returning id into v_conv;
  else
    v_conv := conv.id; v_patient := conv.patient_id; v_lead := conv.lead_id;
    if conv.contact_name is null and nullif(trim(p_name), '') is not null then
      update conversations set contact_name = trim(p_name) where id = v_conv;
    end if;
  end if;

  insert into conversation_messages (conversation_id, direction, body, media_type, media_url, provider_message_id, status, created_at)
  values (v_conv, p_direction, p_body, p_media_type, p_media_url, p_provider_id,
          case when p_direction = 'in' then 'received' else 'sent' end, coalesce(p_at, now()))
  returning id into v_msg;

  return json_build_object('conversation_id', v_conv, 'message_id', v_msg, 'new_conversation', v_new,
                           'patient_id', v_patient, 'lead_id', v_lead, 'branch_id', acc.branch_id, 'duplicate', false);
end $$;
revoke execute on function inbox_receive(text, text, text, text, text, text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke execute on function inbox_conversation(text, uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- turn a lead into a patient, keeping source, clinic and chats
create or replace function convert_lead(p_lead uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare l leads; v uuid; v_first text; v_last text;
begin
  if not has_role('{receptionist,doctor,nurse}') then raise exception 'Not allowed'; end if;
  select * into l from leads where id = p_lead;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.patient_id is not null then return l.patient_id; end if;
  select id into v from patients
   where (phone_key(l.phone) is not null and phone_key(phone) = phone_key(l.phone)) or (l.email is not null and lower(email) = lower(l.email))
   order by created_at limit 1;
  if v is null then
    v_first := split_part(trim(l.name), ' ', 1);
    v_last := nullif(trim(substr(trim(l.name), length(v_first) + 1)), '');
    insert into patients (first_name, last_name, phone, email, source, source_detail, branch_id, lead_id)
    values (v_first, coalesce(v_last, '-'), l.phone, l.email, l.source, l.source_detail, l.branch_id, l.id)
    returning id into v;
  else
    update patients set lead_id = coalesce(lead_id, l.id), source = coalesce(source, l.source),
           source_detail = coalesce(source_detail, l.source_detail), branch_id = coalesce(branch_id, l.branch_id)
     where id = v;
  end if;
  update leads set status = 'converted', patient_id = v, converted_at = now() where id = p_lead;
  update conversations set patient_id = v where lead_id = p_lead and patient_id is null;
  return v;
end $$;
grant execute on function convert_lead(uuid) to authenticated;

-- =====================================================================
-- 3. Automations
-- =====================================================================
create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  key text unique,                 -- built-in rules have a key; custom rules do not
  name text not null,
  description text,
  trigger text not null check (trigger in (
    'appointment_booked','appointment_reminder','appointment_completed','appointment_no_show','appointment_cancelled',
    'follow_up_visit','lead_created','lead_not_contacted','message_received','lab_result_ready','invoice_unpaid',
    'birthday','recall','low_stock','crm_follow_up')),
  enabled boolean not null default false,
  channel text not null default 'auto' check (channel in ('auto','whatsapp','sms','email','staff')),
  delay_minutes int not null default 0,   -- negative = before the event (reminders)
  conditions jsonb not null default '{}'::jsonb,
                                           -- {branch_id, sources[], exclude_sources[], first_message_only, outside_hours:{start,end}, days}
  subject text,
  template text not null default '',
  wa_template text,                -- approved WhatsApp template name (needed for messages sent >24h after the person last wrote)
  wa_language text not null default 'en',
  wa_params text,                  -- template variables in order, e.g. "first_name,doctor,date,time"
  notify_to text,                  -- staff alerts: phone or email of the person to tell
  marketing boolean not null default false,  -- skips patients who opted out of marketing
  run_count int not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_jobs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  trigger text not null,
  entity_type text not null,       -- appointment, visit, lead, message, lab_order, invoice, patient, follow_up, system
  entity_id uuid not null,
  patient_id uuid references patients(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  run_at timestamptz not null,
  dedupe_key text not null unique,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','sent','skipped','failed','cancelled')),
  channel text,
  recipient text,
  result text,
  attempts int not null default 0,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists automation_jobs_due_idx on automation_jobs(run_at) where status = 'pending';
create index if not exists automation_jobs_created_idx on automation_jobs(created_at desc);
create index if not exists automation_jobs_entity_idx on automation_jobs(entity_id);

create or replace function enqueue_automation(p_trigger text, p_entity_type text, p_entity_id uuid, p_base timestamptz,
  p_patient uuid default null, p_lead uuid default null, p_conversation uuid default null, p_branch uuid default null,
  p_meta jsonb default '{}'::jsonb, p_key text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into automation_jobs (automation_id, trigger, entity_type, entity_id, patient_id, lead_id, conversation_id, branch_id, run_at, dedupe_key, meta)
  select a.id, p_trigger, p_entity_type, p_entity_id, p_patient, p_lead, p_conversation, p_branch,
         p_base + make_interval(mins => a.delay_minutes),
         a.id || ':' || p_entity_id || coalesce(':' || p_key, ''), coalesce(p_meta, '{}'::jsonb)
    from automations a
   where a.enabled and a.trigger = p_trigger
     and (nullif(a.conditions->>'branch_id', '') is null or a.conditions->>'branch_id' = p_branch::text)
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function enqueue_automation(text, text, uuid, timestamptz, uuid, uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ---------- events that start automations ----------
create or replace function trg_automation_appointments() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := extract(epoch from new.scheduled_at)::bigint::text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'booked' then
      perform enqueue_automation('appointment_booked', 'appointment', new.id, now(), new.patient_id, null, null, new.branch_id);
      perform enqueue_automation('appointment_reminder', 'appointment', new.id, new.scheduled_at, new.patient_id, null, null, new.branch_id,
                                 jsonb_build_object('scheduled_at', new.scheduled_at), k);
    end if;
    return null;
  end if;
  if new.scheduled_at is distinct from old.scheduled_at and new.status = 'booked' then
    update automation_jobs set status = 'cancelled', result = 'Appointment moved', processed_at = now()
     where entity_id = new.id and trigger = 'appointment_reminder' and status = 'pending';
    perform enqueue_automation('appointment_reminder', 'appointment', new.id, new.scheduled_at, new.patient_id, null, null, new.branch_id,
                               jsonb_build_object('scheduled_at', new.scheduled_at), k);
  end if;
  if new.status is distinct from old.status then
    if new.status in ('cancelled','no_show','completed','in_consultation','checked_in') then
      update automation_jobs set status = 'cancelled', result = 'Appointment ' || replace(new.status::text, '_', ' '), processed_at = now()
       where entity_id = new.id and trigger in ('appointment_reminder','appointment_booked') and status = 'pending'
         and (trigger = 'appointment_reminder' or new.status in ('cancelled','no_show'));
    end if;
    if new.status = 'completed' then
      perform enqueue_automation('appointment_completed', 'appointment', new.id, now(), new.patient_id, null, null, new.branch_id);
    elsif new.status = 'no_show' then
      perform enqueue_automation('appointment_no_show', 'appointment', new.id, now(), new.patient_id, null, null, new.branch_id);
    elsif new.status = 'cancelled' then
      perform enqueue_automation('appointment_cancelled', 'appointment', new.id, now(), new.patient_id, null, null, new.branch_id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists automation_appointments on appointments;
create trigger automation_appointments after insert or update of status, scheduled_at on appointments
  for each row execute function trg_automation_appointments();

create or replace function trg_automation_visits() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.follow_up_date is not null and (tg_op = 'INSERT' or new.follow_up_date is distinct from old.follow_up_date) then
    perform enqueue_automation('follow_up_visit', 'visit', new.id, (new.follow_up_date + time '09:00') at time zone hospital_tz(),
                               new.patient_id, null, null, new.branch_id, jsonb_build_object('follow_up_date', new.follow_up_date), new.follow_up_date::text);
  end if;
  return null;
end $$;
drop trigger if exists automation_visits on visits;
create trigger automation_visits after insert or update of follow_up_date on visits for each row execute function trg_automation_visits();

create or replace function trg_automation_leads() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform enqueue_automation('lead_created', 'lead', new.id, now(), null, new.id, null, new.branch_id);
  perform enqueue_automation('lead_not_contacted', 'lead', new.id, now(), null, new.id, null, new.branch_id);
  return null;
end $$;
drop trigger if exists automation_leads on leads;
create trigger automation_leads after insert on leads for each row execute function trg_automation_leads();

create or replace function trg_automation_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare c conversations;
begin
  if new.direction <> 'in' then return null; end if;
  select * into c from conversations where id = new.conversation_id;
  perform enqueue_automation('message_received', 'message', new.id, now(), c.patient_id, c.lead_id, c.id, c.branch_id,
    jsonb_build_object('first', not exists (select 1 from conversation_messages m where m.conversation_id = c.id and m.id <> new.id)));
  return null;
end $$;
drop trigger if exists automation_messages on conversation_messages;
create trigger automation_messages after insert on conversation_messages for each row execute function trg_automation_messages();

create or replace function trg_automation_lab() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    perform enqueue_automation('lab_result_ready', 'lab_order', new.id, now(), new.patient_id, null, null, new.branch_id);
  end if;
  return null;
end $$;
drop trigger if exists automation_lab on lab_orders;
create trigger automation_lab after update of status on lab_orders for each row execute function trg_automation_lab();

create or replace function trg_automation_invoices() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.patient_id is not null and new.status in ('unpaid','partial') then
    perform enqueue_automation('invoice_unpaid', 'invoice', new.id, now(), new.patient_id, null, null, new.branch_id);
  end if;
  return null;
end $$;
drop trigger if exists automation_invoices on invoices;
create trigger automation_invoices after insert on invoices for each row execute function trg_automation_invoices();

-- ---------- date-based automations: run on every cron call, safe to repeat ----------
create or replace function automation_scan() returns int
language plpgsql security definer set search_path = public as $$
declare
  tz text := hospital_tz();
  today date := (now() at time zone tz)::date;
  nine timestamptz := (today + time '09:00') at time zone tz;
  a automations; n int := 0; m int;
begin
  -- reminders for appointments booked before a reminder rule was switched on
  for a in select * from automations where enabled and trigger = 'appointment_reminder' loop
    insert into automation_jobs (automation_id, trigger, entity_type, entity_id, patient_id, branch_id, run_at, dedupe_key, meta)
    select a.id, a.trigger, 'appointment', ap.id, ap.patient_id, ap.branch_id, ap.scheduled_at + make_interval(mins => a.delay_minutes),
           a.id || ':' || ap.id || ':' || extract(epoch from ap.scheduled_at)::bigint, jsonb_build_object('scheduled_at', ap.scheduled_at)
      from appointments ap
     where ap.status = 'booked' and ap.scheduled_at > now() and ap.scheduled_at < now() + interval '8 days'
       and (nullif(a.conditions->>'branch_id', '') is null or a.conditions->>'branch_id' = ap.branch_id::text)
    on conflict (dedupe_key) do nothing;
    get diagnostics m = row_count; n := n + m;
  end loop;

  for a in select * from automations where enabled and trigger = 'birthday' loop
    insert into automation_jobs (automation_id, trigger, entity_type, entity_id, patient_id, branch_id, run_at, dedupe_key)
    select a.id, a.trigger, 'patient', p.id, p.id, p.branch_id, greatest(nine, now()), a.id || ':' || p.id || ':' || extract(year from today)
      from patients p
     where p.dob is not null and extract(month from p.dob) = extract(month from today) and extract(day from p.dob) = extract(day from today)
       and (nullif(a.conditions->>'branch_id', '') is null or a.conditions->>'branch_id' = p.branch_id::text)
    on conflict (dedupe_key) do nothing;
    get diagnostics m = row_count; n := n + m;
  end loop;

  -- recall: last completed visit was N days ago (30-day window so switching it on does not message years of old patients)
  for a in select * from automations where enabled and trigger = 'recall' loop
    insert into automation_jobs (automation_id, trigger, entity_type, entity_id, patient_id, branch_id, run_at, dedupe_key, meta)
    select a.id, a.trigger, 'patient', x.patient_id, x.patient_id, x.branch_id, greatest(nine, now()),
           a.id || ':' || x.patient_id || ':' || x.last_visit::date, jsonb_build_object('last_visit', x.last_visit, 'appointment_id', x.id)
      from (select distinct on (patient_id) id, patient_id, branch_id, scheduled_at as last_visit
              from appointments where status = 'completed' order by patient_id, scheduled_at desc) x
     where x.last_visit::date between today - coalesce((a.conditions->>'days')::int, 180) - 30 and today - coalesce((a.conditions->>'days')::int, 180)
       and not exists (select 1 from appointments f where f.patient_id = x.patient_id and f.scheduled_at > x.last_visit and f.status <> 'cancelled')
       and (nullif(a.conditions->>'branch_id', '') is null or a.conditions->>'branch_id' = x.branch_id::text)
    on conflict (dedupe_key) do nothing;
    get diagnostics m = row_count; n := n + m;
  end loop;

  for a in select * from automations where enabled and trigger = 'low_stock' loop
    if exists (select 1 from medicine_stock where active and stock <= reorder_level) then
      insert into automation_jobs (automation_id, trigger, entity_type, entity_id, run_at, dedupe_key)
      values (a.id, a.trigger, 'system', a.id, greatest(nine, now()), a.id || ':' || today)
      on conflict (dedupe_key) do nothing;
      get diagnostics m = row_count; n := n + m;
    end if;
  end loop;

  -- CRM follow-ups (SMS / WhatsApp / email) that are due
  for a in select * from automations where enabled and trigger = 'crm_follow_up' loop
    insert into automation_jobs (automation_id, trigger, entity_type, entity_id, patient_id, lead_id, run_at, dedupe_key)
    select a.id, a.trigger, 'follow_up', f.id, f.patient_id, f.lead_id, now(), a.id || ':' || f.id
      from follow_ups f
     where f.status = 'pending' and f.due_date <= today and f.channel in ('sms','whatsapp','email')
    on conflict (dedupe_key) do nothing;
    get diagnostics m = row_count; n := n + m;
  end loop;
  return n;
end $$;
revoke execute on function automation_scan() from public, anon, authenticated;

-- the server (service key) calls these; nobody else can
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function inbox_receive(text, text, text, text, text, text, text, text, jsonb, text, timestamptz) to service_role;
    grant execute on function inbox_conversation(text, uuid, text, text, uuid, uuid, uuid) to service_role;
    grant execute on function automation_scan() to service_role;
    grant execute on function enqueue_automation(text, text, uuid, timestamptz, uuid, uuid, uuid, uuid, jsonb, text) to service_role;
  end if;
end $$;

-- ---------- built-in rules ----------
insert into automations (key, name, description, trigger, enabled, channel, delay_minutes, conditions, template, subject, marketing, wa_params) values
('appt_confirmation', 'Booking confirmation', 'Confirms the appointment as soon as it is booked.', 'appointment_booked', true, 'auto', 0, '{}',
 'Hi {first_name}, your appointment with {doctor} at {clinic} is confirmed for {date} at {time}. Your token number is {token}. Reply here if you need to reschedule.',
 'Appointment confirmed: {date} at {time}', false, 'first_name,doctor,clinic,date,time'),
('appt_reminder_24h', 'Reminder 1 day before', 'Reminds the patient one day before the appointment.', 'appointment_reminder', true, 'auto', -1440, '{}',
 'Hi {first_name}, a friendly reminder of your {visit} with {doctor} on {date} at {time} at {clinic}.{video} Reply here or call {clinic_phone} to reschedule.',
 'Appointment reminder: {date} at {time}', false, 'first_name,doctor,date,time,clinic'),
('appt_reminder_2h', 'Reminder 2 hours before', 'A short same-day reminder with the clinic address.', 'appointment_reminder', false, 'auto', -120, '{}',
 'Hi {first_name}, see you soon! Your appointment with {doctor} is today at {time} at {clinic}, {clinic_address}.', 'See you today at {time}', false, 'first_name,doctor,time,clinic'),
('send_prescription', 'Send prescription after visit', 'Sends the prescription text when the consultation is completed.', 'appointment_completed', false, 'auto', 5, '{}',
 E'Hi {first_name}, here is your prescription from {doctor}:\n\n{prescription}', 'Your prescription from {doctor}', false, null),
('thank_you_review', 'Thank you and review request', 'Thanks the patient after the visit and asks for a review. Add your Google review link first.', 'appointment_completed', false, 'auto', 120, '{}',
 'Thank you for visiting {clinic} today, {first_name}. We hope you feel better soon! If you have a minute, we would love your review: https://g.page/r/YOUR-REVIEW-LINK',
 'Thank you for visiting {clinic}', false, null),
('no_show_rebook', 'Missed appointment', 'Offers a new time when the patient does not come.', 'appointment_no_show', true, 'auto', 60, '{}',
 'Hi {first_name}, we missed you today at {clinic}. Would you like a new time with {doctor}? Reply here or book online: {booking_link}', 'We missed you today', false, null),
('cancelled_rebook', 'Cancelled appointment', 'Invites the patient to pick a new time after a cancellation.', 'appointment_cancelled', false, 'auto', 30, '{}',
 'Hi {first_name}, your appointment on {date} has been cancelled. Whenever you are ready, book a new time here: {booking_link}', 'Your appointment was cancelled', false, null),
('follow_up_visit', 'Follow-up visit reminder', 'Reminds the patient the day before the follow-up date the doctor set.', 'follow_up_visit', true, 'auto', -1440, '{}',
 'Hi {first_name}, {doctor} would like to see you again on {follow_up_date}. Reply here or call {clinic_phone} to book your follow-up visit.', 'Your follow-up visit', false, null),
('lead_welcome', 'New lead welcome', 'Instant reply to website and phone leads. Chat leads get the chat auto-reply instead.', 'lead_created', true, 'auto', 0,
 '{"exclude_sources":["whatsapp","facebook","instagram"]}',
 'Hi {first_name}, thank you for contacting {hospital}. Our team will call you shortly. To book right away: {booking_link}', 'Thank you for contacting {hospital}', false, null),
('lead_alert', 'New lead alert to staff', 'Tells the owner or front desk about every new lead. Add the phone or email to notify.', 'lead_created', false, 'staff', 0, '{}',
 'New lead: {lead_name} ({lead_phone}) from {source} for {clinic}. {message}', 'New lead from {source}', false, null),
('lead_not_contacted', 'Lead not contacted in 1 hour', 'Alerts staff if a lead is still "new" after one hour.', 'lead_not_contacted', false, 'staff', 60, '{}',
 'Reminder: {lead_name} ({lead_phone}) from {source} has not been contacted yet. Open CRM: {admin_link}', 'Lead waiting: {lead_name}', false, null),
('chat_auto_reply', 'Chat auto-reply', 'Replies instantly to the first message on WhatsApp, Facebook or Instagram.', 'message_received', true, 'auto', 0,
 '{"first_message_only":true}',
 'Hi {first_name}, thank you for messaging {clinic}! A team member will reply shortly. You can also book online here: {booking_link}', null, false, null),
('chat_after_hours', 'After-hours chat reply', 'Replies when someone writes while the clinic is closed.', 'message_received', false, 'auto', 0,
 '{"outside_hours":{"start":"09:00","end":"21:00"}}',
 'Thank you for your message. We are closed right now and open from 9 AM to 9 PM. We will reply as soon as we open.', null, false, null),
('lab_ready', 'Lab results ready', 'Tells the patient when lab results are published.', 'lab_result_ready', true, 'auto', 0, '{}',
 'Hi {first_name}, your lab results ({order_no}) are ready. You can view them in your patient portal: {portal_link}', 'Your lab results are ready', false, null),
('invoice_reminder', 'Unpaid bill reminder', 'Reminds the patient 3 days after a bill if it is still unpaid.', 'invoice_unpaid', false, 'auto', 4320, '{}',
 'Hi {first_name}, a friendly reminder that invoice {invoice_no} has a balance of {amount_due}. You can pay online in your patient portal: {portal_link}', 'Balance due on {invoice_no}', false, null),
('birthday', 'Birthday wishes', 'Sends birthday wishes at 9 AM.', 'birthday', false, 'auto', 0, '{}',
 'Happy birthday, {first_name}! Everyone at {clinic} wishes you a healthy and happy year ahead.', 'Happy birthday, {first_name}!', true, null),
('recall_6m', 'Check-up recall (6 months)', 'Invites patients back when their last visit was 6 months ago and nothing is booked.', 'recall', false, 'auto', 0, '{"days":180}',
 'Hi {first_name}, it has been a while since your last visit to {clinic}. Book your check-up with {doctor} here: {booking_link}', 'Time for your check-up', true, null),
('low_stock', 'Low stock alert', 'Sends the pharmacy low-stock list to staff every morning.', 'low_stock', false, 'staff', 0, '{}',
 'Low stock today: {items}', 'Low stock alert', false, null),
('crm_follow_up', 'CRM follow-ups', 'Sends SMS, WhatsApp and email follow-ups from CRM on their due date.', 'crm_follow_up', true, 'auto', 0, '{}',
 'Hi {first_name}, this is {hospital} checking in after your visit. Call us at {phone} if you need anything.', 'A message from {hospital}', false, null)
on conflict (key) do nothing;

-- =====================================================================
-- 4. Dashboard numbers: sources, clinics, chats (all clinics)
-- =====================================================================
create or replace function growth_stats(p_days int default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  return json_build_object(
    'days', p_days,
    'leads_by_source', (select coalesce(json_agg(x order by x.total desc), '[]') from (
        select coalesce(source, 'unknown') source, count(*) total, count(*) filter (where status = 'converted') converted
          from leads where created_at >= since group by 1) x),
    'patients_by_source', (select coalesce(json_agg(x order by x.total desc), '[]') from (
        select coalesce(source, 'unknown') source, count(*) total from patients where created_at >= since group by 1) x),
    'by_clinic', (select coalesce(json_agg(x order by x.visits desc, x.name), '[]') from (
        select b.id, b.name,
          (select count(*) from patients p where p.branch_id = b.id and p.created_at >= since) new_patients,
          (select count(*) from leads l where l.branch_id = b.id and l.created_at >= since) leads,
          (select count(*) from appointments a where a.branch_id = b.id and a.scheduled_at >= since and a.scheduled_at <= now() and a.status not in ('cancelled','no_show')) visits,
          (select count(*) from conversations c where c.branch_id = b.id and c.created_at >= since) chats
        from branches b where b.active) x),
    'chats_by_channel', (select coalesce(json_agg(x order by x.messages_in desc), '[]') from (
        select c.channel,
          count(*) filter (where c.created_at >= since) new_chats,
          count(*) filter (where c.status = 'open') open,
          coalesce(sum(c.unread), 0) unread,
          (select count(*) from conversation_messages m join conversations c2 on c2.id = m.conversation_id
            where c2.channel = c.channel and m.direction = 'in' and m.created_at >= since) messages_in
        from conversations c group by c.channel) x),
    'unread_chats', (select count(*) from conversations where unread > 0),
    'automations_sent', (select count(*) from automation_jobs where status = 'sent' and processed_at >= since),
    'automations_failed', (select count(*) from automation_jobs where status = 'failed' and processed_at >= now() - interval '1 day')
  );
end $$;
grant execute on function growth_stats(int) to authenticated;

-- =====================================================================
-- 5. Security, audit, realtime
-- =====================================================================
do $$
declare rec record;
begin
  for rec in select * from (values
    ('channel_accounts',      'admin_only'),
    ('conversations',         'receptionist,doctor,nurse'),
    ('conversation_messages', 'receptionist,doctor,nurse'),
    ('automations',           'admin_only'),
    ('automation_jobs',       'admin_only')
  ) as v(tbl, writers) loop
    execute format('alter table %I enable row level security', rec.tbl);
    execute format('drop policy if exists staff_read on %I', rec.tbl);
    execute format('drop policy if exists staff_write on %I', rec.tbl);
    execute format('create policy staff_read on %I for select to authenticated using (is_staff())', rec.tbl);
    execute format('create policy staff_write on %I for all to authenticated using (has_role(%L::user_role[])) with check (has_role(%L::user_role[]))',
      rec.tbl, case when rec.writers = 'admin_only' then '{}' else '{' || rec.writers || '}' end,
               case when rec.writers = 'admin_only' then '{}' else '{' || rec.writers || '}' end);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['channel_accounts','automations'] loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function trg_audit()', t);
  end loop;
end $$;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['conversations','conversation_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;
