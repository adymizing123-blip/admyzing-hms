-- =====================================================================
-- CarePlus HMS
-- 05: Hospital upgrade
--   Doctor leave calendar, advance bed reservations, video visits,
--   medication administration record (MAR), OT clinical notes + consumables + billing,
--   insurance claim coding, SMS / WhatsApp / email message log.
-- Safe to run on an existing install (idempotent). Run after 04.
-- =====================================================================

-- ---------- Hospital timezone (used for date rules) ----------
update settings set value = value || '{"timezone":"America/Chicago"}'::jsonb
 where key = 'hospital' and not (value ? 'timezone');

create or replace function hospital_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value->>'timezone' from settings where key = 'hospital'), 'America/Chicago')
$$;

-- =====================================================================
-- 1. Doctor leave calendar
-- =====================================================================
create table if not exists doctor_leaves (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references doctors(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists doctor_leaves_idx on doctor_leaves(doctor_id, start_date, end_date);

create or replace function doctor_on_leave(p_doctor uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from doctor_leaves where doctor_id = p_doctor and p_date between start_date and end_date)
$$;

-- public: which dates a doctor is away (booking calendar greys them out)
create or replace function doctor_leave_dates(p_doctor uuid, p_from date, p_to date) returns setof date
language sql stable security definer set search_path = public as $$
  select distinct d::date
    from doctor_leaves l, generate_series(greatest(l.start_date, p_from), least(l.end_date, p_to), interval '1 day') d
   where l.doctor_id = p_doctor and l.end_date >= p_from and l.start_date <= p_to
$$;
grant execute on function doctor_leave_dates(uuid, date, date) to anon, authenticated;

-- =====================================================================
-- 2. Video visits
-- =====================================================================
alter table appointments add column if not exists visit_type text not null default 'in_person';
alter table appointments add column if not exists video_url text;
alter table appointments add column if not exists reminder_sent_at timestamptz;
do $$ begin
  alter table appointments add constraint appointments_visit_type_chk check (visit_type in ('in_person','video'));
exception when duplicate_object then null; end $$;

-- one trigger guards every way an appointment is created: leave check + video room
create or replace function trg_appointment_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('cancelled','no_show')
     and (tg_op = 'INSERT' or new.scheduled_at is distinct from old.scheduled_at or new.doctor_id is distinct from old.doctor_id)
     and doctor_on_leave(new.doctor_id, (new.scheduled_at at time zone hospital_tz())::date) then
    raise exception 'The doctor is on leave on that day. Please choose another date.';
  end if;
  if new.visit_type = 'video' and new.video_url is null then
    new.video_url := 'https://meet.jit.si/CarePlus-' || replace(gen_random_uuid()::text, '-', '');
  end if;
  return new;
end $$;

drop trigger if exists appointment_rules on appointments;
create trigger appointment_rules before insert or update on appointments
  for each row execute function trg_appointment_rules();

-- booking from the website now supports video visits
drop function if exists book_appointment(uuid, timestamptz, text, text, text, text, date, text);
create or replace function book_appointment(
  p_doctor_id uuid,
  p_scheduled_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_dob date default null,
  p_reason text default null,
  p_visit_type text default 'in_person'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid; v_token int; v_appt uuid; v_source text := 'web'; v_url text;
begin
  if p_scheduled_at < now() then raise exception 'Please choose a future time slot'; end if;
  if not exists (select 1 from doctors where id = p_doctor_id and active) then raise exception 'Doctor not available'; end if;

  v_patient := my_patient_id();
  if v_patient is not null then
    v_source := 'portal';
  else
    select id into v_patient from patients
     where (p_email is not null and lower(email) = lower(p_email))
        or (p_phone is not null and phone = p_phone)
     order by created_at limit 1;
  end if;
  if v_patient is null then
    insert into patients (first_name, last_name, phone, email, dob)
    values (p_first_name, p_last_name, p_phone, p_email, p_dob) returning id into v_patient;
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
grant execute on function book_appointment(uuid, timestamptz, text, text, text, text, date, text, text) to anon, authenticated;

-- =====================================================================
-- 3. Advance bed reservations
-- =====================================================================
create table if not exists bed_reservations (
  id uuid primary key default gen_random_uuid(),
  bed_id uuid not null references beds(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  reserved_from date not null,
  reserved_to date not null,
  reason text,
  status text not null default 'reserved' check (status in ('reserved','admitted','cancelled')),
  admission_id uuid references admissions(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (reserved_to >= reserved_from)
);

create or replace function reserve_bed(p_bed uuid, p_patient uuid, p_doctor uuid, p_from date, p_to date, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_role(array['doctor','nurse','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  if p_from < (now() at time zone hospital_tz())::date then raise exception 'Reservation cannot start in the past'; end if;
  if exists (select 1 from bed_reservations where bed_id = p_bed and status = 'reserved'
             and daterange(reserved_from, reserved_to, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'This bed is already reserved for part of those dates';
  end if;
  insert into bed_reservations (bed_id, patient_id, doctor_id, reserved_from, reserved_to, reason, created_by)
  values (p_bed, p_patient, p_doctor, p_from, p_to, p_reason, auth.uid()) returning id into v;
  return v;
end $$;

-- admit now respects reservations
create or replace function admit_patient(p_patient uuid, p_doctor uuid, p_bed uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_res bed_reservations; v_today date := (now() at time zone hospital_tz())::date;
begin
  if not has_role(array['doctor','nurse','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  if exists (select 1 from admissions where patient_id = p_patient and status = 'admitted') then
    raise exception 'Patient is already admitted';
  end if;
  select * into v_res from bed_reservations
   where bed_id = p_bed and status = 'reserved' and v_today between reserved_from and reserved_to limit 1;
  if found and v_res.patient_id <> p_patient then
    raise exception 'This bed is reserved for another patient today';
  end if;
  update beds set status = 'occupied' where id = p_bed and status = 'available';
  if not found then raise exception 'Bed is not available'; end if;
  insert into admissions (patient_id, doctor_id, bed_id, reason)
  values (p_patient, p_doctor, p_bed, p_reason) returning id into v_id;
  if v_res.id is not null then
    update bed_reservations set status = 'admitted', admission_id = v_id where id = v_res.id;
  end if;
  return v_id;
end $$;

create or replace function admit_reservation(p_reservation uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r bed_reservations; v_id uuid;
begin
  select * into r from bed_reservations where id = p_reservation and status = 'reserved';
  if not found then raise exception 'Reservation not found'; end if;
  v_id := admit_patient(r.patient_id, r.doctor_id, r.bed_id, coalesce(r.reason, 'Planned admission'));
  update bed_reservations set status = 'admitted', admission_id = v_id where id = p_reservation;
  return v_id;
end $$;

-- =====================================================================
-- 4. Medication Administration Record (MAR)
-- =====================================================================
create table if not exists medication_orders (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions(id) on delete cascade,
  medicine_id uuid references medicines(id) on delete set null,
  medicine_name text not null,
  dose text,
  units_per_dose int not null default 1 check (units_per_dose > 0),
  route text not null default 'oral',
  frequency text,
  times text[] not null default '{08:00,20:00}',
  prn boolean not null default false,           -- "as needed", no fixed times
  start_date date not null default current_date,
  end_date date,
  instructions text,
  status text not null default 'active' check (status in ('active','stopped')),
  ordered_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists medication_administrations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references medication_orders(id) on delete cascade,
  admission_id uuid not null references admissions(id) on delete cascade,
  scheduled_for timestamptz,                     -- null for PRN doses
  status text not null check (status in ('given','held','refused','missed')),
  recorded_at timestamptz not null default now(),
  given_by uuid references profiles(id),
  batch_id uuid references medicine_batches(id),
  notes text
);
create unique index if not exists mar_one_per_slot on medication_administrations(order_id, scheduled_for) where scheduled_for is not null;

create or replace function mar_record(p_order uuid, p_scheduled timestamptz, p_status text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare o medication_orders; v_id uuid; v_batch uuid; v_need int; b record; v_take int;
begin
  if not has_role(array['nurse','doctor']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into o from medication_orders where id = p_order;
  if not found then raise exception 'Medication order not found'; end if;
  if o.status <> 'active' then raise exception 'This medication has been stopped'; end if;
  if not exists (select 1 from admissions where id = o.admission_id and status = 'admitted') then
    raise exception 'Patient is no longer admitted';
  end if;
  if p_status in ('held','refused') and nullif(trim(coalesce(p_notes,'')), '') is null then
    raise exception 'Please add a reason when a dose is held or refused';
  end if;

  -- giving a dose takes it from pharmacy stock (first-expiry first-out)
  if p_status = 'given' and o.medicine_id is not null then
    v_need := o.units_per_dose;
    if (select coalesce(sum(quantity),0) from medicine_batches where medicine_id = o.medicine_id and expiry_date >= current_date) < v_need then
      raise exception 'Not enough % in stock. Ask pharmacy to restock.', o.medicine_name;
    end if;
    for b in select id, quantity from medicine_batches
              where medicine_id = o.medicine_id and quantity > 0 and expiry_date >= current_date
              order by expiry_date, received_at for update loop
      exit when v_need <= 0;
      v_take := least(v_need, b.quantity);
      update medicine_batches set quantity = quantity - v_take where id = b.id;
      v_batch := coalesce(v_batch, b.id);
      v_need := v_need - v_take;
    end loop;
  end if;

  insert into medication_administrations (order_id, admission_id, scheduled_for, status, given_by, batch_id, notes)
  values (p_order, o.admission_id, p_scheduled, p_status, auth.uid(), v_batch, nullif(trim(coalesce(p_notes,'')), ''))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'This dose has already been recorded';
end $$;

-- discharge now also bills the medicines given on the ward
create or replace function discharge_patient(p_admission uuid, p_summary text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_adm admissions; v_rate numeric; v_days int; v_inv uuid; v_ward text;
begin
  if not has_role(array['doctor','nurse','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into v_adm from admissions where id = p_admission and status = 'admitted' for update;
  if not found then raise exception 'Admission not found'; end if;

  select w.daily_rate, w.name into v_rate, v_ward from beds b join wards w on w.id = b.ward_id where b.id = v_adm.bed_id;
  v_days := greatest(1, ceil(extract(epoch from (now() - v_adm.admitted_at)) / 86400)::int);

  insert into invoices (patient_id, created_by, notes) values (v_adm.patient_id, auth.uid(), 'Inpatient stay') returning id into v_inv;
  insert into invoice_items (invoice_id, category, description, quantity, unit_price)
  values (v_inv, 'room', coalesce(v_ward,'Ward') || ' stay (' || v_days || ' day/s)', v_days, coalesce(v_rate,0));

  insert into invoice_items (invoice_id, category, description, quantity, unit_price)
  select v_inv, 'pharmacy', 'Ward medication: ' || o.medicine_name, sum(o.units_per_dose), m.price
    from medication_administrations a
    join medication_orders o on o.id = a.order_id
    join medicines m on m.id = o.medicine_id
   where a.admission_id = p_admission and a.status = 'given'
   group by o.medicine_name, m.price;

  update medication_orders set status = 'stopped' where admission_id = p_admission and status = 'active';
  update admissions set status = 'discharged', discharged_at = now(), discharge_summary = p_summary, invoice_id = v_inv where id = p_admission;
  update beds set status = 'cleaning' where id = v_adm.bed_id;
  return v_inv;
end $$;

-- =====================================================================
-- 5. Operation theatre: clinical notes, consumables, billing
-- =====================================================================
alter table ot_schedules add column if not exists anesthesia_type text;
alter table ot_schedules add column if not exists anesthetist_id uuid references doctors(id) on delete set null;
alter table ot_schedules add column if not exists pre_op_notes text;
alter table ot_schedules add column if not exists anesthesia_notes text;
alter table ot_schedules add column if not exists operative_notes text;
alter table ot_schedules add column if not exists post_op_notes text;
alter table ot_schedules add column if not exists complications text;
alter table ot_schedules add column if not exists blood_loss_ml int;
alter table ot_schedules add column if not exists actual_start timestamptz;
alter table ot_schedules add column if not exists actual_end timestamptz;
alter table ot_schedules add column if not exists procedure_fee numeric(12,2) not null default 0;
alter table ot_schedules add column if not exists procedure_code text;
alter table ot_schedules add column if not exists invoice_id uuid references invoices(id) on delete set null;

alter table inventory_items add column if not exists unit_price numeric(10,2) not null default 0;

create table if not exists ot_consumables (
  id uuid primary key default gen_random_uuid(),
  ot_id uuid not null references ot_schedules(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  medicine_id uuid references medicines(id) on delete set null,
  name text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create or replace function ot_add_consumable(p_ot uuid, p_item uuid, p_medicine uuid, p_qty int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_price numeric := 0; v_need int := p_qty; b record; v_take int;
begin
  if not has_role(array['doctor','nurse']::user_role[]) then raise exception 'Not allowed'; end if;
  if (select invoice_id from ot_schedules where id = p_ot) is not null then raise exception 'This surgery has already been billed'; end if;
  if p_item is not null then
    select name, unit_price into v_name, v_price from inventory_items where id = p_item;
    -- the inventory trigger checks and reduces stock
    insert into inventory_transactions (item_id, txn_type, quantity, note, created_by)
    values (p_item, 'out', p_qty, 'Used in OT', auth.uid());
  elsif p_medicine is not null then
    select name || coalesce(' ' || strength, ''), price into v_name, v_price from medicines where id = p_medicine;
    if (select coalesce(sum(quantity),0) from medicine_batches where medicine_id = p_medicine and expiry_date >= current_date) < p_qty then
      raise exception 'Not enough % in stock', v_name;
    end if;
    for b in select id, quantity from medicine_batches where medicine_id = p_medicine and quantity > 0 and expiry_date >= current_date
              order by expiry_date, received_at for update loop
      exit when v_need <= 0;
      v_take := least(v_need, b.quantity);
      update medicine_batches set quantity = quantity - v_take where id = b.id;
      v_need := v_need - v_take;
    end loop;
  else
    raise exception 'Choose an item or medicine';
  end if;
  insert into ot_consumables (ot_id, inventory_item_id, medicine_id, name, quantity, unit_price, created_by)
  values (p_ot, p_item, p_medicine, v_name, p_qty, coalesce(v_price, 0), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function ot_bill(p_ot uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare o ot_schedules; v_inv uuid;
begin
  if not has_role(array['doctor','nurse','receptionist','accountant']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into o from ot_schedules where id = p_ot for update;
  if o.invoice_id is not null then return o.invoice_id; end if;
  insert into invoices (patient_id, created_by, notes) values (o.patient_id, auth.uid(), 'Surgery: ' || o.procedure_name) returning id into v_inv;
  if o.procedure_fee > 0 then
    insert into invoice_items (invoice_id, category, description, quantity, unit_price, code)
    values (v_inv, 'procedure', o.procedure_name, 1, o.procedure_fee, o.procedure_code);
  end if;
  insert into invoice_items (invoice_id, category, description, quantity, unit_price)
  select v_inv, case when medicine_id is not null then 'pharmacy' else 'procedure' end, 'OT: ' || name, quantity, unit_price
    from ot_consumables where ot_id = p_ot and unit_price > 0;
  update ot_schedules set invoice_id = v_inv where id = p_ot;
  return v_inv;
end $$;

-- =====================================================================
-- 6. Insurance claim coding (CPT / ICD-10)
-- =====================================================================
alter table invoice_items add column if not exists code text;          -- CPT / HCPCS
alter table visits add column if not exists icd10_codes text;          -- e.g. "J06.9, R50.9"
alter table lab_tests add column if not exists cpt_code text;
alter table insurance_claims add column if not exists payer_id text;
alter table insurance_claims add column if not exists diagnosis_codes text;
alter table insurance_claims add column if not exists submitted_at timestamptz;
alter table insurance_claims add column if not exists submission_status text not null default 'not_sent';
alter table insurance_claims add column if not exists submission_response text;

update lab_tests t set cpt_code = v.cpt from (values
  ('CBC','85025'),('CMP','80053'),('LIPID','80061'),('HBA1C','83036'),('TSH','84443'),('UA','81003'),
  ('VITD','82306'),('COVID','87635'),('CXR','71046'),('ECG','93000'),('USABD','76700'),('MRIB','70551')
) v(code, cpt) where t.code = v.code and t.cpt_code is null;

create or replace function bill_lab_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_o lab_orders; v_inv uuid;
begin
  if not has_role(array['lab_tech','receptionist','accountant']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into v_o from lab_orders where id = p_order;
  insert into invoices (patient_id, created_by, notes) values (v_o.patient_id, auth.uid(), 'Lab ' || v_o.order_no) returning id into v_inv;
  insert into invoice_items (invoice_id, category, description, quantity, unit_price, code)
  select v_inv, 'lab', t.name, 1, i.price, t.cpt_code
    from lab_order_items i join lab_tests t on t.id = i.lab_test_id where i.lab_order_id = p_order;
  return v_inv;
end $$;

-- =====================================================================
-- 7. Messaging (SMS / WhatsApp / email)
-- =====================================================================
alter table patients add column if not exists marketing_opt_out boolean not null default false;
alter table campaigns add column if not exists sent_count int not null default 0;
alter table campaigns add column if not exists failed_count int not null default 0;
alter table campaigns add column if not exists subject text;
alter table campaigns add column if not exists sent_at timestamptz;

create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms','whatsapp','email')),
  to_address text not null,
  subject text,
  body text not null,
  status text not null check (status in ('sent','failed','skipped')),
  provider_id text,
  error text,
  purpose text,                 -- reminder, follow_up, campaign, manual
  patient_id uuid references patients(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  sent_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists message_log_created_idx on message_log(created_at desc);

-- =====================================================================
-- RLS for new tables
-- =====================================================================
do $$
declare rec record;
begin
  for rec in select * from (values
    ('doctor_leaves',              'receptionist'),
    ('bed_reservations',           '{}'),
    ('medication_orders',          'doctor'),
    ('medication_administrations', '{}'),
    ('ot_consumables',             '{}'),
    ('message_log',                '{}')
  ) as v(tbl, writers) loop
    execute format('alter table %I enable row level security', rec.tbl);
    execute format('drop policy if exists staff_read on %I', rec.tbl);
    execute format('drop policy if exists staff_write on %I', rec.tbl);
    execute format('create policy staff_read on %I for select to authenticated using (is_staff())', rec.tbl);
    execute format('create policy staff_write on %I for all to authenticated using (has_role(%L::user_role[])) with check (has_role(%L::user_role[]))',
      rec.tbl, case when rec.writers = '{}' then '{}' else '{' || rec.writers || '}' end, case when rec.writers = '{}' then '{}' else '{' || rec.writers || '}' end);
  end loop;
end $$;

-- reservations can be cancelled by front desk / nurses
drop policy if exists cancel_reservation on bed_reservations;
create policy cancel_reservation on bed_reservations for update to authenticated
  using (has_role('{doctor,nurse,receptionist}'::user_role[]) and status = 'reserved')
  with check (status = 'cancelled');

-- nurses can stop a medication order, doctors can edit them
drop policy if exists nurse_stop on medication_orders;
create policy nurse_stop on medication_orders for update to authenticated
  using (has_role('{nurse}'::user_role[])) with check (status = 'stopped');

do $$
declare t text;
begin
  foreach t in array array['doctor_leaves','bed_reservations','medication_orders','medication_administrations','ot_consumables'] loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function trg_audit()', t);
  end loop;
end $$;

-- patients see their own video link (column already covered by existing appointment policy)
