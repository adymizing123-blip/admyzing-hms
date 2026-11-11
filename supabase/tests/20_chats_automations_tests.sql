-- Tests for 08_chats_automations.sql. Run after 10_tests.sql (see scripts/test-db.sh).
\set ON_ERROR_STOP 1
reset role;

-- two clinics, each with its own WhatsApp number; one Instagram account
insert into branches (name, code) values ('Gulberg Clinic', 'GUL'), ('DHA Clinic', 'DHA') on conflict do nothing;
insert into channel_accounts (channel, account_id, name, branch_id) values
  ('whatsapp', 'WA-GUL', 'Gulberg WhatsApp', (select id from branches where code = 'GUL')),
  ('whatsapp', 'WA-DHA', 'DHA WhatsApp', (select id from branches where code = 'DHA')),
  ('instagram', 'IG-1', 'Clinic Instagram', (select id from branches where code = 'DHA'));

-- ---------- incoming chats ----------
do $$
declare r json; r2 json; r3 json; c uuid;
begin
  r := inbox_receive('whatsapp', 'WA-GUL', '+923001112222', 'Ayesha Khan', 'Hi, I want an appointment', null, null, 'wamid.1',
                     '{"headline":"Free skin consult ad","source_type":"ad"}');
  c := (r->>'conversation_id')::uuid;
  assert (r->>'new_conversation')::boolean, 'first message opens a conversation';
  assert (select source from leads where id = (r->>'lead_id')::uuid) = 'whatsapp', 'chat lead source is the channel';
  assert (select source_detail from leads where id = (r->>'lead_id')::uuid) = 'Free skin consult ad', 'ad headline kept on the lead';
  assert (select b.code from leads l join branches b on b.id = l.branch_id where l.id = (r->>'lead_id')::uuid) = 'GUL', 'lead gets the clinic of the WhatsApp number';
  assert (select b.code from conversations x join branches b on b.id = x.branch_id where x.id = c) = 'GUL', 'chat tagged with the clinic';

  r2 := inbox_receive('whatsapp', 'WA-GUL', '+923001112222', 'Ayesha Khan', 'Tomorrow evening?', null, null, 'wamid.2');
  assert (r2->>'conversation_id')::uuid = c and not (r2->>'new_conversation')::boolean, 'second message, same conversation';
  assert (select unread from conversations where id = c) = 2, 'unread counter';
  assert (select last_message_preview from conversations where id = c) = 'Tomorrow evening?', 'preview updated';

  r3 := inbox_receive('whatsapp', 'WA-GUL', '+923001112222', 'Ayesha Khan', 'Tomorrow evening?', null, null, 'wamid.2');
  assert (r3->>'duplicate')::boolean, 'webhook retries are ignored';
  assert (select count(*) from conversation_messages where conversation_id = c) = 2, 'no duplicate message';
  assert (select count(*) from leads where phone = '+923001112222') = 1, 'one lead per person';

  -- same person on the other clinic's number is a separate chat for that clinic (replies go from the right number)
  r := inbox_receive('whatsapp', 'WA-DHA', '+923001112222', 'Ayesha Khan', 'Hello DHA');
  assert (r->>'conversation_id')::uuid <> c, 'separate chat per clinic number';
  assert (r->>'lead_id')::uuid = (select id from leads where phone = '+923001112222'), 'reuses the open lead';

  -- automations: first message gets the chat auto-reply, later ones do not
  assert (select count(*) from automation_jobs j join automations a on a.id = j.automation_id
           where a.key = 'chat_auto_reply' and j.conversation_id = c) = 2, 'job per inbound message';
  assert (select count(*) from automation_jobs j join automations a on a.id = j.automation_id
           where a.key = 'chat_auto_reply' and j.conversation_id = c and (j.meta->>'first')::boolean) = 1, 'only the first is marked first';
  assert not exists (select 1 from automation_jobs j join automations a on a.id = j.automation_id
                      where a.key = 'lead_welcome' and j.lead_id = (select id from leads where phone = '+923001112222') and j.status = 'sent'), 'nothing sent by SQL itself';

  -- Instagram: no phone, lead without phone
  r := inbox_receive('instagram', 'IG-1', '17841400000001', 'sara.styles', 'Price for laser?');
  assert (select source from leads where id = (r->>'lead_id')::uuid) = 'instagram', 'instagram lead';
  assert (select phone from leads where id = (r->>'lead_id')::uuid) is null, 'instagram lead has no phone';

  -- a message we sent from the phone app (echo) is stored as outgoing and does not open a lead
  r := inbox_receive('whatsapp', 'WA-GUL', '+923001112222', null, 'Yes, 6pm works', null, null, 'wamid.echo1', null, 'out');
  assert (select direction from conversation_messages where id = (r->>'message_id')::uuid) = 'out', 'echo stored as outgoing';
  assert (select unread from conversations where id = c) = 2, 'echo does not change unread';
end $$;

-- ---------- a known patient writing on WhatsApp is matched, no lead ----------
do $$
declare r json; p uuid;
begin
  insert into patients (first_name, last_name, phone, source) values ('Bilal', 'Ahmed', '0300 555 6666', 'walk_in') returning id into p;
  r := inbox_receive('whatsapp', 'WA-DHA', '+923005556666', 'Bilal', 'Report ready?');
  assert (r->>'patient_id')::uuid = p, 'matched to patient by phone';
  assert (r->>'lead_id') is null, 'no lead for a known patient';
end $$;

-- ---------- registering the person as a patient converts the lead and keeps its source ----------
do $$
declare p uuid; l uuid := (select id from leads where phone = '+923001112222');
begin
  insert into patients (first_name, last_name, phone) values ('Ayesha', 'Khan', '0300-1112222') returning id into p;
  assert (select source from patients where id = p) = 'whatsapp', 'patient keeps lead source';
  assert (select source_detail from patients where id = p) = 'Free skin consult ad', 'patient keeps ad name';
  assert (select b.code from patients x join branches b on b.id = x.branch_id where x.id = p) = 'GUL', 'patient keeps lead clinic';
  assert (select status from leads where id = l) = 'converted' and (select patient_id from leads where id = l) = p, 'lead converted';
  assert (select count(*) from conversations where lead_id = l and patient_id = p) = 2, 'chats linked to the patient';
end $$;

-- ---------- convert_lead (CRM button) ----------
insert into leads (name, phone, source, status, branch_id) values ('Usman Tariq Malik', '+923217778888', 'facebook', 'new', (select id from branches where code = 'DHA'));
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');  -- pharmacist
select pg_temp.expect_error($$select convert_lead((select id from leads where phone = '+923217778888'))$$, 'not allowed');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');  -- admin
do $$
declare p uuid;
begin
  p := convert_lead((select id from leads where phone = '+923217778888'));
  assert (select first_name || '|' || last_name || '|' || source from patients where id = p) = 'Usman|Tariq Malik|facebook', 'convert_lead copies name and source';
  assert convert_lead((select id from leads where phone = '+923217778888')) = p, 'converting twice returns the same patient';
end $$;
reset role;

-- ---------- appointments start automations ----------
do $$
declare a uuid; pat uuid := (select id from patients where phone = '0300-1112222'); doc uuid := (select id from doctors where active limit 1);
  t timestamptz := date_trunc('hour', now()) + interval '3 days';
begin
  insert into appointments (patient_id, doctor_id, scheduled_at, branch_id, source)
  values (pat, doc, t, (select id from branches where code = 'DHA'), 'whatsapp') returning id into a;
  assert exists (select 1 from automation_jobs j join automations x on x.id = j.automation_id where x.key = 'appt_confirmation' and j.entity_id = a and j.status = 'pending'), 'confirmation queued';
  assert (select run_at from automation_jobs j join automations x on x.id = j.automation_id where x.key = 'appt_reminder_24h' and j.entity_id = a) = t - interval '1 day', 'reminder 24h before';
  assert not exists (select 1 from automation_jobs j join automations x on x.id = j.automation_id where x.key = 'appt_reminder_2h' and j.entity_id = a), 'disabled rule not queued';

  update appointments set scheduled_at = t + interval '1 day' where id = a;
  assert (select count(*) from automation_jobs j join automations x on x.id = j.automation_id where x.key = 'appt_reminder_24h' and j.entity_id = a and j.status = 'cancelled') = 1, 'old reminder cancelled on reschedule';
  assert (select run_at from automation_jobs j join automations x on x.id = j.automation_id where x.key = 'appt_reminder_24h' and j.entity_id = a and j.status = 'pending') = t, 'new reminder for new time';

  update appointments set status = 'no_show' where id = a;
  assert not exists (select 1 from automation_jobs where entity_id = a and trigger = 'appointment_reminder' and status = 'pending'), 'no reminder after no-show';
  assert exists (select 1 from automation_jobs j join automations x on x.id = j.automation_id where x.key = 'no_show_rebook' and j.entity_id = a), 'missed appointment message queued';
end $$;

-- ---------- scan is safe to repeat; birthday and low stock ----------
do $$
declare n1 int; n2 int;
begin
  update automations set enabled = true, notify_to = '+923000000000' where key in ('birthday', 'low_stock');
  update patients set dob = ((now() at time zone hospital_tz())::date - interval '30 years')::date where phone = '0300 555 6666';
  update medicines set reorder_level = 1000000 where sku = 'MED-001';
  n1 := automation_scan();
  n2 := automation_scan();
  assert n1 >= 2, 'scan queues birthday and low stock';
  assert n2 = 0, 'second scan adds nothing';
  assert exists (select 1 from automation_jobs j join automations x on x.id = j.automation_id where x.key = 'birthday'
                  and j.patient_id = (select id from patients where phone = '0300 555 6666')), 'birthday queued';
end $$;

-- ---------- website booking keeps the ad source ----------
set role anon; select pg_temp.act_as(null);
select book_appointment((select id from doctors where active limit 1), date_trunc('day', now()) + interval '50 days 16 hours',
                        'Hina', 'Raza', '0333 4445555', 'hina@test.com', null, null, 'in_person', 'instagram');
reset role;
do $$ begin
  assert (select source from patients where email = 'hina@test.com') = 'instagram', 'booking with ?utm_source=instagram';
  assert (select a.source from appointments a join patients p on p.id = a.patient_id where p.email = 'hina@test.com') = 'instagram', 'appointment source';
end $$;

-- ---------- security ----------
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');  -- pharmacist
do $$ begin
  update automations set enabled = false where key = 'chat_auto_reply';
  assert (select enabled from automations where key = 'chat_auto_reply'), 'only admin can change automations';
end $$;
select pg_temp.expect_error($$select inbox_receive('whatsapp','WA-GUL','+1','x','spoof')$$, 'permission denied');
select pg_temp.expect_error($$select automation_scan()$$, 'permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');  -- patient
do $$ begin assert (select count(*) from conversations) = 0, 'patients cannot read chats'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$
declare g json := growth_stats(30);
begin
  assert exists (select 1 from json_array_elements(g->'leads_by_source') e where e->>'source' = 'whatsapp' and (e->>'converted')::int = 1), 'growth: whatsapp lead converted';
  assert exists (select 1 from json_array_elements(g->'chats_by_channel') e where e->>'channel' = 'instagram'), 'growth: instagram chats';
  assert exists (select 1 from json_array_elements(g->'by_clinic') e where e->>'name' = 'Gulberg Clinic' and (e->>'chats')::int = 1), 'growth: chats per clinic';
end $$;
reset role;

\echo ALL CHAT AND AUTOMATION TESTS PASSED
