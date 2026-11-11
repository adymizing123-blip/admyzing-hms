-- =====================================================================
-- CarePlus Hospital Management System
-- 01: Tables, enums, sequences
-- Run in Supabase SQL Editor (or psql) in order: 01, 02, 03
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
do $$ begin
  create type user_role as enum ('admin','doctor','nurse','receptionist','pharmacist','lab_tech','accountant','patient');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appointment_status as enum ('booked','checked_in','in_consultation','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bed_status as enum ('available','occupied','cleaning','maintenance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('draft','unpaid','partial','paid','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lab_status as enum ('ordered','collected','processing','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('pending','paid','processing','shipped','delivered','cancelled');
exception when duplicate_object then null; end $$;

-- ---------- Sequences for human-readable numbers ----------
create sequence if not exists mrn_seq start 100001;
create sequence if not exists invoice_seq start 10001;
create sequence if not exists order_seq start 5001;
create sequence if not exists sale_seq start 1001;
create sequence if not exists lab_seq start 2001;

-- ---------- Users / profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role user_role not null default 'patient',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------- Organisation ----------
create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  icon text default 'Stethoscope',
  created_at timestamptz not null default now()
);

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  full_name text not null,
  role user_role not null,
  department_id uuid references departments(id) on delete set null,
  phone text,
  email text,
  hire_date date default current_date,
  pay_type text not null default 'salary' check (pay_type in ('salary','hourly')),
  base_salary numeric(12,2) default 0,      -- monthly
  hourly_rate numeric(10,2) default 0,
  commission_pct numeric(5,2) default 0,    -- % of consultation fees (doctors)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete set null,
  staff_id uuid references staff(id) on delete set null,
  full_name text not null,
  department_id uuid references departments(id) on delete set null,
  specialty text,
  qualification text,
  bio text,
  photo_url text,
  consultation_fee numeric(10,2) not null default 100,
  available_days int[] not null default '{1,2,3,4,5}',   -- 0=Sun..6=Sat
  start_time time not null default '09:00',
  end_time time not null default '17:00',
  slot_minutes int not null default 20,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Patients / EMR ----------
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  mrn text not null unique default ('MRN' || nextval('mrn_seq')),
  profile_id uuid unique references profiles(id) on delete set null,
  first_name text not null,
  last_name text not null,
  dob date,
  gender text check (gender in ('male','female','other')),
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  blood_group text,
  allergies text,
  chronic_conditions text,
  insurance_provider text,
  insurance_member_id text,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now()
);
create index if not exists patients_phone_idx on patients(phone);
create index if not exists patients_email_idx on patients(lower(email));
create index if not exists patients_name_idx on patients(lower(last_name), lower(first_name));

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid not null references doctors(id) on delete cascade,
  scheduled_at timestamptz not null,
  status appointment_status not null default 'booked',
  token_no int,
  reason text,
  source text not null default 'walk_in' check (source in ('web','walk_in','phone','portal')),
  created_at timestamptz not null default now()
);
create index if not exists appointments_doctor_time_idx on appointments(doctor_id, scheduled_at);
create unique index if not exists appointments_slot_unique on appointments(doctor_id, scheduled_at)
  where status not in ('cancelled','no_show');

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments(id) on delete set null,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  vitals jsonb not null default '{}'::jsonb,   -- {bp, pulse, temp, weight, height, spo2}
  complaints text,
  diagnosis text,
  notes text,
  follow_up_date date,
  created_at timestamptz not null default now()
);

create table if not exists prescriptions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visits(id) on delete cascade,
  medicine_id uuid,
  medicine_name text not null,
  dosage text,
  frequency text,
  duration text,
  instructions text,
  created_at timestamptz not null default now()
);

create table if not exists patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  title text not null,
  file_path text not null,      -- path in storage bucket "documents"
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- IPD ----------
create table if not exists wards (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  ward_type text not null default 'general',   -- general, private, icu, maternity
  daily_rate numeric(10,2) not null default 300,
  created_at timestamptz not null default now()
);

create table if not exists beds (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references wards(id) on delete cascade,
  bed_no text not null,
  status bed_status not null default 'available',
  unique (ward_id, bed_no)
);

create table if not exists admissions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  bed_id uuid references beds(id) on delete set null,
  reason text,
  admitted_at timestamptz not null default now(),
  discharged_at timestamptz,
  status text not null default 'admitted' check (status in ('admitted','discharged')),
  discharge_summary text,
  invoice_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists nursing_notes (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions(id) on delete cascade,
  note text not null,
  vitals jsonb default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists ot_schedules (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  procedure_name text not null,
  theatre text not null default 'OT-1',
  scheduled_at timestamptz not null,
  duration_minutes int default 60,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Pharmacy ----------
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists medicines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  generic_name text,
  category text,
  form text,                        -- tablet, syrup, injection
  strength text,
  sku text unique,
  barcode text unique,
  price numeric(10,2) not null default 0,     -- selling price per unit
  cost numeric(10,2) not null default 0,
  reorder_level int not null default 20,
  requires_prescription boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table prescriptions drop constraint if exists prescriptions_medicine_fk;
alter table prescriptions add constraint prescriptions_medicine_fk
  foreign key (medicine_id) references medicines(id) on delete set null;

create table if not exists medicine_batches (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references medicines(id) on delete cascade,
  batch_no text not null,
  expiry_date date not null,
  quantity int not null default 0 check (quantity >= 0),
  cost numeric(10,2) default 0,
  supplier_id uuid references suppliers(id) on delete set null,
  received_at timestamptz not null default now()
);
create index if not exists batches_med_expiry_idx on medicine_batches(medicine_id, expiry_date);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','ordered','received','cancelled')),
  total numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  medicine_id uuid not null references medicines(id),
  quantity int not null check (quantity > 0),
  unit_cost numeric(10,2) not null default 0
);

create table if not exists pharmacy_sales (
  id uuid primary key default gen_random_uuid(),
  sale_no text not null unique default ('RX-' || nextval('sale_seq')),
  patient_id uuid references patients(id) on delete set null,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  cashier_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists pharmacy_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references pharmacy_sales(id) on delete cascade,
  medicine_id uuid not null references medicines(id),
  batch_id uuid references medicine_batches(id),
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null,
  line_total numeric(12,2) not null
);

-- ---------- Laboratory ----------
create table if not exists lab_tests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  category text,
  sample_type text,
  normal_range text,
  unit text,
  price numeric(10,2) not null default 0,
  turnaround_hours int default 24,
  active boolean not null default true
);

create table if not exists lab_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('LAB-' || nextval('lab_seq')),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  visit_id uuid references visits(id) on delete set null,
  status lab_status not null default 'ordered',
  notes text,
  report_path text,
  ordered_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists lab_order_items (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references lab_orders(id) on delete cascade,
  lab_test_id uuid not null references lab_tests(id),
  result text,
  flag text check (flag in ('normal','high','low','critical')),
  price numeric(10,2) not null default 0
);

-- ---------- Billing ----------
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique default ('INV-' || nextval('invoice_seq')),
  patient_id uuid references patients(id) on delete set null,
  status invoice_status not null default 'unpaid',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  notes text,
  due_date date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table admissions drop constraint if exists admissions_invoice_fk;
alter table admissions add constraint admissions_invoice_fk
  foreign key (invoice_id) references invoices(id) on delete set null;

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  category text not null default 'other'
    check (category in ('consultation','lab','pharmacy','room','procedure','other')),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash','card','stripe','insurance','check','other')),
  reference text,
  received_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists insurance_claims (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  provider text not null,
  member_id text,
  claim_no text,
  amount numeric(12,2) not null default 0,
  status text not null default 'submitted' check (status in ('submitted','approved','denied','paid')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text,
  amount numeric(12,2) not null,
  spent_on date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------- CRM ----------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  source text not null default 'website',   -- website, facebook, instagram, phone, referral, walk_in
  interest text,
  message text,
  status text not null default 'new' check (status in ('new','contacted','qualified','converted','lost')),
  assigned_to uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  due_date date not null,
  channel text not null default 'call' check (channel in ('call','sms','email','whatsapp')),
  message text,
  status text not null default 'pending' check (status in ('pending','done','skipped')),
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null default 'email' check (channel in ('email','sms','whatsapp')),
  audience text,
  message text,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft','scheduled','sent')),
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete set null,
  rating int check (rating between 1 and 5),
  comment text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);

-- ---------- Online store ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category text,
  description text,
  price numeric(10,2) not null,
  image_url text,
  stock int not null default 0,
  medicine_id uuid references medicines(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('ORD-' || nextval('order_seq')),
  patient_id uuid references patients(id) on delete set null,
  customer_name text not null,
  email text not null,
  phone text,
  shipping_address text,
  subtotal numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status order_status not null default 'pending',
  payment_method text not null default 'stripe',
  stripe_session_id text,
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(10,2) not null,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

-- ---------- General inventory ----------
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,             -- surgical, consumable, equipment, linen
  unit text default 'pcs',
  quantity int not null default 0,
  reorder_level int not null default 10,
  location text,
  created_at timestamptz not null default now()
);

create table if not exists inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  txn_type text not null check (txn_type in ('in','out')),
  quantity int not null check (quantity > 0),
  department_id uuid references departments(id),
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- HR ----------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  work_date date not null default current_date,
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'present' check (status in ('present','absent','leave','half_day')),
  unique (staff_id, work_date)
);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  shift_date date not null,
  shift_name text not null default 'Morning',   -- Morning, Evening, Night
  start_time time not null default '08:00',
  end_time time not null default '16:00'
);

create table if not exists payroll (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  base_pay numeric(12,2) not null default 0,
  commission numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) generated always as (base_pay + commission - deductions) stored,
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  unique (staff_id, period_start)
);

-- ---------- Audit log ----------
create table if not exists audit_logs (
  id bigserial primary key,
  table_name text not null,
  record_id text,
  action text not null,
  changed_by uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ---------- Settings ----------
create table if not exists settings (
  key text primary key,
  value jsonb not null
);
-- =====================================================================
-- CarePlus HMS
-- 02: Helper functions, business logic (RPC), triggers, Row Level Security
-- =====================================================================

-- ---------- Role helpers ----------
create or replace function app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role <> 'patient' from profiles where id = auth.uid()), false)
$$;

create or replace function has_role(roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or role = any(roles) from profiles where id = auth.uid()), false)
$$;

create or replace function my_patient_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from patients where profile_id = auth.uid()
$$;

-- ---------- New user signup -> profile + patient record ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_existing uuid;
begin
  insert into profiles (id, full_name, email, phone, role)
  values (new.id, v_name, new.email, new.raw_user_meta_data->>'phone', 'patient')
  on conflict (id) do nothing;

  -- link to an existing patient record with the same email (e.g. booked online earlier)
  select id into v_existing from patients
   where lower(email) = lower(new.email) and profile_id is null
   order by created_at limit 1;

  if v_existing is not null then
    update patients set profile_id = new.id where id = v_existing;
  else
    insert into patients (profile_id, first_name, last_name, email, phone)
    values (new.id,
            split_part(v_name, ' ', 1),
            coalesce(nullif(substr(v_name, length(split_part(v_name, ' ', 1)) + 2), ''), '-'),
            new.email,
            new.raw_user_meta_data->>'phone');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- When a user is promoted to a staff role, remove the empty patient record created at signup
create or replace function handle_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'patient' and new.role <> 'patient' then
    delete from patients p
     where p.profile_id = new.id
       and not exists (select 1 from appointments a where a.patient_id = p.id)
       and not exists (select 1 from invoices i where i.patient_id = p.id)
       and not exists (select 1 from orders o where o.patient_id = p.id);
  end if;
  return new;
end $$;

drop trigger if exists on_profile_role_change on profiles;
create trigger on_profile_role_change
  after update of role on profiles
  for each row execute function handle_role_change();

-- ---------- Public: available slots ----------
create or replace function booked_slots(p_doctor_id uuid, p_date date)
returns setof timestamptz
language sql stable security definer set search_path = public as $$
  select scheduled_at from appointments
   where doctor_id = p_doctor_id
     and scheduled_at >= p_date::timestamptz
     and scheduled_at <  (p_date + 1)::timestamptz
     and status not in ('cancelled','no_show')
$$;

-- ---------- Public: book appointment (website / portal) ----------
create or replace function book_appointment(
  p_doctor_id uuid,
  p_scheduled_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_dob date default null,
  p_reason text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid;
  v_token int;
  v_appt uuid;
  v_source text := 'web';
begin
  if p_scheduled_at < now() then
    raise exception 'Please choose a future time slot';
  end if;

  if not exists (select 1 from doctors where id = p_doctor_id and active) then
    raise exception 'Doctor not available';
  end if;

  -- logged-in patient?
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
    values (p_first_name, p_last_name, p_phone, p_email, p_dob)
    returning id into v_patient;
  end if;

  if exists (select 1 from appointments where doctor_id = p_doctor_id
             and scheduled_at = p_scheduled_at and status not in ('cancelled','no_show')) then
    raise exception 'This slot was just booked. Please pick another time.';
  end if;

  select coalesce(max(token_no), 0) + 1 into v_token from appointments
   where doctor_id = p_doctor_id
     and scheduled_at::date = p_scheduled_at::date;

  insert into appointments (patient_id, doctor_id, scheduled_at, token_no, reason, source)
  values (v_patient, p_doctor_id, p_scheduled_at, v_token, p_reason, v_source)
  returning id into v_appt;

  return json_build_object('appointment_id', v_appt, 'token_no', v_token);
end $$;

-- ---------- Staff: walk-in token ----------
create or replace function next_token(p_doctor_id uuid, p_date date)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(token_no), 0) + 1 from appointments
   where doctor_id = p_doctor_id and scheduled_at::date = p_date
$$;

-- ---------- Invoice totals ----------
create or replace function recalc_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric; v_paid numeric; v_inv invoices;
begin
  select * into v_inv from invoices where id = p_invoice;
  if not found then return; end if;
  select coalesce(sum(line_total),0) into v_sub from invoice_items where invoice_id = p_invoice;
  select coalesce(sum(amount),0) into v_paid from payments where invoice_id = p_invoice;
  update invoices set
    subtotal = v_sub,
    total = greatest(v_sub - discount + tax, 0),
    amount_paid = v_paid,
    status = case
      when status in ('void','draft') then status
      when v_paid <= 0 then 'unpaid'::invoice_status
      when v_paid >= greatest(v_sub - discount + tax, 0) then 'paid'::invoice_status
      else 'partial'::invoice_status end
  where id = p_invoice;
end $$;

create or replace function trg_invoice_child() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

drop trigger if exists invoice_items_recalc on invoice_items;
create trigger invoice_items_recalc after insert or update or delete on invoice_items
  for each row execute function trg_invoice_child();

drop trigger if exists payments_recalc on payments;
create trigger payments_recalc after insert or update or delete on payments
  for each row execute function trg_invoice_child();

create or replace function trg_invoice_discount() returns trigger
language plpgsql as $$
begin
  if new.discount is distinct from old.discount or new.tax is distinct from old.tax then
    new.total := greatest(new.subtotal - new.discount + new.tax, 0);
    if new.status not in ('void','draft') then
      new.status := case when new.amount_paid <= 0 then 'unpaid'::invoice_status
                         when new.amount_paid >= new.total then 'paid'::invoice_status
                         else 'partial'::invoice_status end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists invoices_discount on invoices;
create trigger invoices_discount before update on invoices
  for each row execute function trg_invoice_discount();

-- ---------- Pharmacy POS checkout (FEFO: first-expiry, first-out) ----------
-- p_items: [{"medicine_id": "...", "quantity": 2}, ...]
create or replace function pos_checkout(
  p_items jsonb,
  p_patient_id uuid default null,
  p_discount numeric default 0,
  p_tax_rate numeric default 0,
  p_payment_method text default 'cash'
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_sale uuid; v_sale_no text;
  v_item jsonb; v_med medicines; v_need int; v_take int;
  v_batch record; v_sub numeric := 0; v_tax numeric; v_total numeric;
begin
  if not has_role(array['pharmacist','receptionist']::user_role[]) then
    raise exception 'Not allowed';
  end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;

  insert into pharmacy_sales (patient_id, payment_method, cashier_id)
  values (p_patient_id, p_payment_method, auth.uid())
  returning id, sale_no into v_sale, v_sale_no;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_med from medicines where id = (v_item->>'medicine_id')::uuid;
    if not found then raise exception 'Medicine not found'; end if;
    v_need := (v_item->>'quantity')::int;

    if (select coalesce(sum(quantity),0) from medicine_batches
        where medicine_id = v_med.id and expiry_date >= current_date) < v_need then
      raise exception 'Not enough stock for %', v_med.name;
    end if;

    for v_batch in
      select id, quantity from medicine_batches
       where medicine_id = v_med.id and quantity > 0 and expiry_date >= current_date
       order by expiry_date, received_at
       for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_batch.quantity);
      update medicine_batches set quantity = quantity - v_take where id = v_batch.id;
      insert into pharmacy_sale_items (sale_id, medicine_id, batch_id, quantity, unit_price, line_total)
      values (v_sale, v_med.id, v_batch.id, v_take, v_med.price, v_take * v_med.price);
      v_sub := v_sub + v_take * v_med.price;
      v_need := v_need - v_take;
    end loop;
  end loop;

  v_tax := round((v_sub - coalesce(p_discount,0)) * coalesce(p_tax_rate,0) / 100, 2);
  v_total := greatest(v_sub - coalesce(p_discount,0) + v_tax, 0);

  update pharmacy_sales set subtotal = v_sub, discount = coalesce(p_discount,0), tax = v_tax, total = v_total
   where id = v_sale;

  return json_build_object('sale_id', v_sale, 'sale_no', v_sale_no, 'total', v_total);
end $$;

-- ---------- Purchase order receive -> creates batches ----------
create or replace function receive_purchase_order(p_po uuid, p_expiry date)
returns void language plpgsql security definer set search_path = public as $$
declare v_po purchase_orders; r record;
begin
  if not has_role(array['pharmacist']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into v_po from purchase_orders where id = p_po for update;
  if v_po.status = 'received' then raise exception 'Already received'; end if;
  for r in select * from purchase_order_items where purchase_order_id = p_po loop
    insert into medicine_batches (medicine_id, batch_no, expiry_date, quantity, cost, supplier_id)
    values (r.medicine_id, 'PO-' || left(p_po::text, 8), p_expiry, r.quantity, r.unit_cost, v_po.supplier_id);
  end loop;
  update purchase_orders set status = 'received' where id = p_po;
end $$;

-- ---------- IPD: admit & discharge ----------
create or replace function admit_patient(p_patient uuid, p_doctor uuid, p_bed uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_role(array['doctor','nurse','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  if exists (select 1 from admissions where patient_id = p_patient and status = 'admitted') then
    raise exception 'Patient is already admitted';
  end if;
  update beds set status = 'occupied' where id = p_bed and status = 'available';
  if not found then raise exception 'Bed is not available'; end if;
  insert into admissions (patient_id, doctor_id, bed_id, reason)
  values (p_patient, p_doctor, p_bed, p_reason) returning id into v_id;
  return v_id;
end $$;

create or replace function transfer_bed(p_admission uuid, p_new_bed uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not has_role(array['doctor','nurse','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  select bed_id into v_old from admissions where id = p_admission and status = 'admitted';
  update beds set status = 'occupied' where id = p_new_bed and status = 'available';
  if not found then raise exception 'Bed is not available'; end if;
  update beds set status = 'cleaning' where id = v_old;
  update admissions set bed_id = p_new_bed where id = p_admission;
end $$;

create or replace function discharge_patient(p_admission uuid, p_summary text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_adm admissions; v_rate numeric; v_days int; v_inv uuid; v_ward text;
begin
  if not has_role(array['doctor','nurse','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into v_adm from admissions where id = p_admission and status = 'admitted' for update;
  if not found then raise exception 'Admission not found'; end if;

  select w.daily_rate, w.name into v_rate, v_ward
    from beds b join wards w on w.id = b.ward_id where b.id = v_adm.bed_id;
  v_days := greatest(1, ceil(extract(epoch from (now() - v_adm.admitted_at)) / 86400)::int);

  insert into invoices (patient_id, created_by, notes)
  values (v_adm.patient_id, auth.uid(), 'Inpatient stay')
  returning id into v_inv;

  insert into invoice_items (invoice_id, category, description, quantity, unit_price)
  values (v_inv, 'room', coalesce(v_ward,'Ward') || ' stay (' || v_days || ' day/s)', v_days, coalesce(v_rate,0));

  update admissions set status = 'discharged', discharged_at = now(),
         discharge_summary = p_summary, invoice_id = v_inv
   where id = p_admission;
  update beds set status = 'cleaning' where id = v_adm.bed_id;
  return v_inv;
end $$;

-- ---------- Lab: bill an order ----------
create or replace function bill_lab_order(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_o lab_orders; v_inv uuid;
begin
  if not has_role(array['lab_tech','receptionist','accountant']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into v_o from lab_orders where id = p_order;
  insert into invoices (patient_id, created_by, notes) values (v_o.patient_id, auth.uid(), 'Lab ' || v_o.order_no)
  returning id into v_inv;
  insert into invoice_items (invoice_id, category, description, quantity, unit_price)
  select v_inv, 'lab', t.name, 1, i.price
    from lab_order_items i join lab_tests t on t.id = i.lab_test_id where i.lab_order_id = p_order;
  return v_inv;
end $$;

-- ---------- Store: mark order paid and reduce stock ----------
create or replace function mark_order_paid(p_order uuid, p_session text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update orders set status = 'paid', stripe_session_id = coalesce(p_session, stripe_session_id)
   where id = p_order and status = 'pending';
  if found then
    update products p set stock = greatest(p.stock - oi.quantity, 0)
      from order_items oi where oi.order_id = p_order and oi.product_id = p.id;
  end if;
end $$;
revoke execute on function mark_order_paid(uuid, text) from public, anon, authenticated;

-- ---------- Inventory movement ----------
create or replace function trg_inventory_txn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.txn_type = 'in' then
    update inventory_items set quantity = quantity + new.quantity where id = new.item_id;
  else
    update inventory_items set quantity = quantity - new.quantity where id = new.item_id and quantity >= new.quantity;
    if not found then raise exception 'Not enough stock'; end if;
  end if;
  return new;
end $$;

drop trigger if exists inventory_txn_apply on inventory_transactions;
create trigger inventory_txn_apply after insert on inventory_transactions
  for each row execute function trg_inventory_txn();

-- ---------- HR: generate payroll for a month ----------
create or replace function generate_payroll(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_count int := 0; s record; v_base numeric; v_comm numeric; v_hours numeric;
begin
  if not has_role(array['accountant']::user_role[]) then raise exception 'Not allowed'; end if;
  for s in select * from staff where active loop
    if s.pay_type = 'hourly' then
      select coalesce(sum(extract(epoch from (check_out - check_in)) / 3600), 0) into v_hours
        from attendance where staff_id = s.id and work_date between v_start and v_end and check_out is not null;
      v_base := round(v_hours * s.hourly_rate, 2);
    else
      v_base := s.base_salary;
    end if;

    select coalesce(sum(ii.line_total), 0) * s.commission_pct / 100 into v_comm
      from invoice_items ii
      join invoices i on i.id = ii.invoice_id and i.status = 'paid'
      join doctors d on d.staff_id = s.id
     where ii.category = 'consultation'
       and ii.description like '%' || d.full_name || '%'
       and i.created_at::date between v_start and v_end;

    insert into payroll (staff_id, period_start, period_end, base_pay, commission)
    values (s.id, v_start, v_end, v_base, round(coalesce(v_comm,0), 2))
    on conflict (staff_id, period_start) do update
      set base_pay = excluded.base_pay, commission = excluded.commission
      where payroll.status = 'pending';
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------- Views for alerts ----------
create or replace view medicine_stock with (security_invoker = true) as
select m.id, m.name, m.generic_name, m.category, m.form, m.strength, m.sku, m.barcode,
       m.price, m.cost, m.reorder_level, m.requires_prescription, m.active,
       coalesce(sum(b.quantity) filter (where b.expiry_date >= current_date), 0)::int as stock,
       min(b.expiry_date) filter (where b.quantity > 0 and b.expiry_date >= current_date) as next_expiry
  from medicines m left join medicine_batches b on b.medicine_id = m.id
 group by m.id;

drop view if exists expiring_batches;
create view expiring_batches with (security_invoker = true) as
select b.*, m.name as medicine_name
  from medicine_batches b join medicines m on m.id = b.medicine_id
 where b.quantity > 0 and b.expiry_date <= current_date + 60
 order by b.expiry_date;

-- ---------- Dashboard ----------
create or replace function dashboard_stats() returns json
language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select json_build_object(
    'appointments_today', (select count(*) from appointments where scheduled_at::date = current_date and status <> 'cancelled'),
    'waiting', (select count(*) from appointments where scheduled_at::date = current_date and status = 'checked_in'),
    'admitted', (select count(*) from admissions where status = 'admitted'),
    'beds_total', (select count(*) from beds),
    'beds_available', (select count(*) from beds where status = 'available'),
    'revenue_today', (select coalesce(sum(amount),0) from payments where created_at::date = current_date)
                    + (select coalesce(sum(total),0) from pharmacy_sales where created_at::date = current_date)
                    + (select coalesce(sum(total),0) from orders where created_at::date = current_date and status not in ('pending','cancelled')),
    'outstanding', (select coalesce(sum(total - amount_paid),0) from invoices where status in ('unpaid','partial')),
    'low_stock', (select count(*) from medicine_stock where active and stock <= reorder_level),
    'expiring', (select count(*) from expiring_batches),
    'pending_labs', (select count(*) from lab_orders where status in ('ordered','collected','processing')),
    'new_leads', (select count(*) from leads where status = 'new'),
    'pending_orders', (select count(*) from orders where status in ('paid','processing')),
    'patients_total', (select count(*) from patients),
    'revenue_30d', (
      select coalesce(json_agg(json_build_object('day', d::date, 'amount', coalesce(x.amt,0)) order by d), '[]'::json)
        from generate_series(current_date - 29, current_date, interval '1 day') d
        left join (
          select created_at::date as day, sum(amount) as amt from payments group by 1
          union all
          select created_at::date, sum(total) from pharmacy_sales group by 1
          union all
          select created_at::date, sum(total) from orders where status not in ('pending','cancelled') group by 1
        ) x on x.day = d::date
    ),
    'revenue_by_category', (
      select coalesce(json_agg(json_build_object('category', category, 'amount', amt)), '[]'::json) from (
        select ii.category, sum(ii.line_total) amt from invoice_items ii
          join invoices i on i.id = ii.invoice_id
         where i.created_at >= current_date - 30 and i.status <> 'void'
         group by 1
        union all
        select 'pharmacy', coalesce(sum(total),0) from pharmacy_sales where created_at >= current_date - 30
        union all
        select 'store', coalesce(sum(total),0) from orders where created_at >= current_date - 30 and status not in ('pending','cancelled')
      ) t
    )
  ) into v;
  return v;
end $$;

-- ---------- Audit trigger ----------
create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (table_name, record_id, action, changed_by, old_data, new_data)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, null),
          tg_op, auth.uid(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients','visits','prescriptions','admissions','invoices','payments',
                           'lab_order_items','medicines','medicine_batches','staff','payroll','profiles']
  loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I
                    for each row execute function trg_audit()', t);
  end loop;
end $$;

-- =====================================================================
-- Row Level Security
-- Rule: every staff member can READ operational data; only the listed roles can WRITE.
-- Admin can always write. Patients only see their own records.
-- =====================================================================
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('departments',          'admin'),
      ('staff',                'accountant'),
      ('doctors',              'receptionist'),
      ('patients',             'receptionist,doctor,nurse'),
      ('appointments',         'receptionist,doctor,nurse'),
      ('visits',               'doctor,nurse'),
      ('prescriptions',        'doctor'),
      ('patient_documents',    'doctor,nurse,receptionist,lab_tech'),
      ('wards',                'nurse'),
      ('beds',                 'nurse,receptionist'),
      ('admissions',           'doctor,nurse,receptionist'),
      ('nursing_notes',        'nurse,doctor'),
      ('ot_schedules',         'doctor,nurse,receptionist'),
      ('suppliers',            'pharmacist'),
      ('medicines',            'pharmacist'),
      ('medicine_batches',     'pharmacist'),
      ('purchase_orders',      'pharmacist'),
      ('purchase_order_items', 'pharmacist'),
      ('pharmacy_sales',       'pharmacist'),
      ('pharmacy_sale_items',  'pharmacist'),
      ('lab_tests',            'lab_tech'),
      ('lab_orders',           'lab_tech,doctor,receptionist'),
      ('lab_order_items',      'lab_tech,doctor,receptionist'),
      ('invoices',             'accountant,receptionist,doctor,nurse,lab_tech'),
      ('invoice_items',        'accountant,receptionist,doctor,nurse,lab_tech'),
      ('payments',             'accountant,receptionist'),
      ('insurance_claims',     'accountant'),
      ('expenses',             'accountant'),
      ('leads',                'receptionist'),
      ('follow_ups',           'receptionist,doctor,nurse'),
      ('campaigns',            'receptionist'),
      ('feedback',             'receptionist'),
      ('products',             'pharmacist'),
      ('orders',               'pharmacist,receptionist'),
      ('order_items',          'pharmacist,receptionist'),
      ('inventory_items',      'nurse,pharmacist'),
      ('inventory_transactions','nurse,pharmacist'),
      ('attendance',           'accountant,receptionist'),
      ('shifts',               'accountant'),
      ('payroll',              'accountant'),
      ('audit_logs',           'admin'),
      ('settings',             'admin'),
      ('profiles',             'admin')
    ) as v(tbl, writers)
  loop
    execute format('alter table %I enable row level security', rec.tbl);
    execute format('drop policy if exists staff_read on %I', rec.tbl);
    execute format('drop policy if exists staff_write on %I', rec.tbl);
    execute format('create policy staff_read on %I for select to authenticated using (is_staff())', rec.tbl);
    execute format(
      'create policy staff_write on %I for all to authenticated using (has_role(%L::user_role[])) with check (has_role(%L::user_role[]))',
      rec.tbl, '{' || rec.writers || '}', '{' || rec.writers || '}');
  end loop;
end $$;

-- Audit logs: admin read only
drop policy if exists staff_read on audit_logs;
drop policy if exists admin_read on audit_logs;
create policy admin_read on audit_logs for select to authenticated using (has_role('{}'::user_role[]));

-- Salaries / payroll: only accountant + admin can read
drop policy if exists staff_read on payroll;
drop policy if exists payroll_read on payroll;
create policy payroll_read on payroll for select to authenticated using (has_role('{accountant}'::user_role[]));

-- ---------- Public (anonymous website visitors) ----------
drop policy if exists public_read on departments;
create policy public_read on departments for select to anon, authenticated using (true);
drop policy if exists public_read on doctors;
create policy public_read on doctors for select to anon, authenticated using (active);
drop policy if exists public_read on products;
create policy public_read on products for select to anon, authenticated using (active);
drop policy if exists public_read on lab_tests;
create policy public_read on lab_tests for select to anon, authenticated using (active);
drop policy if exists public_read on settings;
create policy public_read on settings for select to anon, authenticated using (key = 'hospital');
drop policy if exists public_insert on leads;
create policy public_insert on leads for insert to anon, authenticated with check (status = 'new');
drop policy if exists public_insert on feedback;
create policy public_insert on feedback for insert to anon, authenticated with check (true);

-- ---------- Patients: own records ----------
drop policy if exists own_profile on profiles;
create policy own_profile on profiles for select to authenticated using (id = auth.uid());
drop policy if exists own_profile_update on profiles;
create policy own_profile_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = app_role());

drop policy if exists own_patient on patients;
create policy own_patient on patients for select to authenticated using (profile_id = auth.uid());
drop policy if exists own_patient_update on patients;
create policy own_patient_update on patients for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists own_rows on appointments;
create policy own_rows on appointments for select to authenticated using (patient_id = my_patient_id());
drop policy if exists own_cancel on appointments;
create policy own_cancel on appointments for update to authenticated
  using (patient_id = my_patient_id() and status = 'booked')
  with check (patient_id = my_patient_id() and status = 'cancelled');

drop policy if exists own_rows on visits;
create policy own_rows on visits for select to authenticated using (patient_id = my_patient_id());
drop policy if exists own_rows on prescriptions;
create policy own_rows on prescriptions for select to authenticated
  using (exists (select 1 from visits v where v.id = visit_id and v.patient_id = my_patient_id()));
drop policy if exists own_rows on lab_orders;
create policy own_rows on lab_orders for select to authenticated using (patient_id = my_patient_id());
drop policy if exists own_rows on lab_order_items;
create policy own_rows on lab_order_items for select to authenticated
  using (exists (select 1 from lab_orders o where o.id = lab_order_id and o.patient_id = my_patient_id() and o.status = 'completed'));
drop policy if exists own_rows on invoices;
create policy own_rows on invoices for select to authenticated using (patient_id = my_patient_id() and status <> 'draft');
drop policy if exists own_rows on invoice_items;
create policy own_rows on invoice_items for select to authenticated
  using (exists (select 1 from invoices i where i.id = invoice_id and i.patient_id = my_patient_id()));
drop policy if exists own_rows on orders;
create policy own_rows on orders for select to authenticated using (patient_id = my_patient_id());
drop policy if exists own_rows on order_items;
create policy own_rows on order_items for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id and o.patient_id = my_patient_id()));
drop policy if exists own_rows on patient_documents;
create policy own_rows on patient_documents for select to authenticated using (patient_id = my_patient_id());
drop policy if exists own_rows on admissions;
create policy own_rows on admissions for select to authenticated using (patient_id = my_patient_id());

-- ---------- Function permissions ----------
grant execute on function booked_slots(uuid, date) to anon, authenticated;
grant execute on function book_appointment(uuid, timestamptz, text, text, text, text, date, text) to anon, authenticated;

-- ---------- Storage buckets ----------
-- "documents" (private): lab reports, scans, uploaded files
-- "public"    (public):  product images, doctor photos
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('documents','documents', false) on conflict do nothing;
    insert into storage.buckets (id, name, public) values ('public','public', true) on conflict do nothing;

    execute 'drop policy if exists "staff manage documents" on storage.objects';
    execute 'create policy "staff manage documents" on storage.objects for all to authenticated
             using (bucket_id = ''documents'' and public.is_staff())
             with check (bucket_id = ''documents'' and public.is_staff())';
    execute 'drop policy if exists "staff manage public" on storage.objects';
    execute 'create policy "staff manage public" on storage.objects for all to authenticated
             using (bucket_id = ''public'' and public.is_staff())
             with check (bucket_id = ''public'' and public.is_staff())';
    execute 'drop policy if exists "patients read own documents" on storage.objects';
    execute 'create policy "patients read own documents" on storage.objects for select to authenticated
             using (bucket_id = ''documents'' and (storage.foldername(name))[1] = public.my_patient_id()::text)';
  end if;
end $$;
-- =====================================================================
-- CarePlus HMS
-- 04: Pharmacy POS upgrade
--   Shifts and cash drawer, split payments, returns and refunds,
--   prescription check, charge to patient bill, card terminal references.
-- Safe to run on an existing install (idempotent).
-- =====================================================================

create sequence if not exists return_seq start 501;
create sequence if not exists shift_seq start 101;

-- ---------- Shifts (cash drawer) ----------
create table if not exists pos_shifts (
  id uuid primary key default gen_random_uuid(),
  shift_no text not null unique default ('SH-' || nextval('shift_seq')),
  cashier_id uuid not null references profiles(id),
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(12,2) not null default 0,
  expected_cash numeric(12,2),
  counted_cash numeric(12,2),
  difference numeric(12,2),
  summary jsonb,
  notes text
);
create unique index if not exists pos_shifts_one_open on pos_shifts(cashier_id) where status = 'open';

create table if not exists pos_cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references pos_shifts(id) on delete cascade,
  movement_type text not null check (movement_type in ('in','out')),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- Sales: extra columns ----------
alter table pharmacy_sales add column if not exists shift_id uuid references pos_shifts(id);
alter table pharmacy_sales add column if not exists invoice_id uuid references invoices(id) on delete set null;
alter table pharmacy_sales add column if not exists rx_note text;
alter table pharmacy_sales add column if not exists change_given numeric(12,2) not null default 0;
alter table pharmacy_sales add column if not exists refunded_total numeric(12,2) not null default 0;
alter table pharmacy_sales add column if not exists status text not null default 'completed';
do $$ begin
  alter table pharmacy_sales add constraint pharmacy_sales_status_chk check (status in ('completed','partially_refunded','refunded'));
exception when duplicate_object then null; end $$;

-- ---------- Split payments ----------
create table if not exists pharmacy_sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references pharmacy_sales(id) on delete cascade,
  method text not null check (method in ('cash','card','insurance','bill')),
  amount numeric(12,2) not null check (amount > 0),
  reference text,                 -- card last 4, insurance claim, Stripe PaymentIntent id
  created_at timestamptz not null default now()
);

-- ---------- Returns ----------
create table if not exists pharmacy_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique default ('RT-' || nextval('return_seq')),
  sale_id uuid not null references pharmacy_sales(id) on delete cascade,
  shift_id uuid references pos_shifts(id),
  refund_method text not null check (refund_method in ('cash','card','insurance','bill')),
  total numeric(12,2) not null default 0,
  reason text,
  reference text,                 -- Stripe refund id, etc.
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists pharmacy_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references pharmacy_returns(id) on delete cascade,
  sale_item_id uuid not null references pharmacy_sale_items(id),
  quantity int not null check (quantity > 0),
  amount numeric(12,2) not null,
  restocked boolean not null default true
);

-- ---------- Helpers ----------
create or replace function my_open_shift() returns uuid
language sql stable security definer set search_path = public as $$
  select id from pos_shifts where cashier_id = auth.uid() and status = 'open' limit 1
$$;

create or replace function pos_open_shift(p_opening_cash numeric default 0) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_role(array['pharmacist','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  if my_open_shift() is not null then raise exception 'You already have an open shift'; end if;
  insert into pos_shifts (cashier_id, opening_cash) values (auth.uid(), coalesce(p_opening_cash, 0)) returning id into v;
  return v;
end $$;

create or replace function pos_cash_movement(p_type text, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_shift uuid := my_open_shift();
begin
  if v_shift is null then raise exception 'Open a shift first'; end if;
  insert into pos_cash_movements (shift_id, movement_type, amount, reason, created_by)
  values (v_shift, p_type, p_amount, p_reason, auth.uid());
end $$;

-- Prescriptions this patient has for a medicine in the last 180 days
create or replace function patient_has_rx(p_patient uuid, p_medicine uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from prescriptions p
      join visits v on v.id = p.visit_id
      join medicines m on m.id = p_medicine
     where v.patient_id = p_patient
       and v.created_at > now() - interval '180 days'
       and (p.medicine_id = p_medicine or p.medicine_name ilike m.name || '%')
  )
$$;

-- ---------- Checkout (replaces the original single-payment version) ----------
drop function if exists pos_checkout(jsonb, uuid, numeric, numeric, text);

-- p_items:    [{"medicine_id": "...", "quantity": 2}]
-- p_payments: [{"method": "cash", "amount": 20, "reference": null}, {"method": "card", "amount": 5.40, "reference": "pi_..."}]
--             cash may exceed the balance; the excess is returned as change.
create or replace function pos_checkout(
  p_items jsonb,
  p_payments jsonb,
  p_patient_id uuid default null,
  p_discount numeric default 0,
  p_tax_rate numeric default 0,
  p_rx_note text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_shift uuid := my_open_shift();
  v_sale uuid; v_sale_no text;
  v_item jsonb; v_med medicines; v_need int; v_take int; v_batch record;
  v_sub numeric := 0; v_tax numeric; v_total numeric;
  v_pay jsonb; v_paid numeric := 0; v_cash numeric := 0; v_change numeric := 0;
  v_bill numeric := 0; v_inv uuid; v_method text; v_amt numeric; v_x numeric;
begin
  if not has_role(array['pharmacist','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  if v_shift is null then raise exception 'Open a shift before making sales'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'Add a payment'; end if;

  -- prescription check
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_med from medicines where id = (v_item->>'medicine_id')::uuid;
    if not found then raise exception 'Medicine not found'; end if;
    if v_med.requires_prescription and nullif(trim(coalesce(p_rx_note, '')), '') is null then
      if p_patient_id is null then
        raise exception '% needs a prescription. Link the patient or enter the prescription details.', v_med.name;
      elsif not patient_has_rx(p_patient_id, v_med.id) then
        raise exception 'No prescription on file for %. Enter the prescription details to continue.', v_med.name;
      end if;
    end if;
  end loop;

  insert into pharmacy_sales (patient_id, payment_method, cashier_id, shift_id, rx_note)
  values (p_patient_id, 'split', auth.uid(), v_shift, nullif(trim(coalesce(p_rx_note, '')), ''))
  returning id, sale_no into v_sale, v_sale_no;

  -- stock deduction, first-expiry first-out
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_med from medicines where id = (v_item->>'medicine_id')::uuid;
    v_need := (v_item->>'quantity')::int;
    if v_need is null or v_need <= 0 then raise exception 'Invalid quantity for %', v_med.name; end if;
    if (select coalesce(sum(quantity),0) from medicine_batches
        where medicine_id = v_med.id and expiry_date >= current_date) < v_need then
      raise exception 'Not enough stock for %', v_med.name;
    end if;
    for v_batch in
      select id, quantity from medicine_batches
       where medicine_id = v_med.id and quantity > 0 and expiry_date >= current_date
       order by expiry_date, received_at
       for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_batch.quantity);
      update medicine_batches set quantity = quantity - v_take where id = v_batch.id;
      insert into pharmacy_sale_items (sale_id, medicine_id, batch_id, quantity, unit_price, line_total)
      values (v_sale, v_med.id, v_batch.id, v_take, v_med.price, v_take * v_med.price);
      v_sub := v_sub + v_take * v_med.price;
      v_need := v_need - v_take;
    end loop;
  end loop;

  p_discount := least(greatest(coalesce(p_discount, 0), 0), v_sub);
  v_tax := round((v_sub - p_discount) * coalesce(p_tax_rate, 0) / 100, 2);
  v_total := round(v_sub - p_discount + v_tax, 2);

  -- validate payments
  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_amt := round(coalesce((v_pay->>'amount')::numeric, 0), 2);
    if v_amt <= 0 then continue; end if;
    v_paid := v_paid + v_amt;
    if v_pay->>'method' = 'cash' then v_cash := v_cash + v_amt; end if;
  end loop;
  if v_paid < v_total then raise exception 'Payment is short by %', to_char(v_total - v_paid, 'FM999990.00'); end if;
  v_change := v_paid - v_total;
  if v_change > v_cash then raise exception 'Only cash can be over-tendered. Reduce the card/insurance/bill amount.'; end if;

  -- record payments (cash reduced by change)
  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := v_pay->>'method';
    v_amt := round(coalesce((v_pay->>'amount')::numeric, 0), 2);
    if v_amt <= 0 then continue; end if;
    if v_method = 'cash' and v_change > 0 then
      v_x := least(v_amt, v_change);
      v_amt := v_amt - v_x;
      v_change := v_change - v_x;
      if v_amt <= 0 then continue; end if;
    end if;
    if v_method = 'bill' then
      if p_patient_id is null then raise exception 'Link a patient to charge their hospital bill'; end if;
      v_bill := v_bill + v_amt;
    end if;
    insert into pharmacy_sale_payments (sale_id, method, amount, reference)
    values (v_sale, v_method, v_amt, nullif(v_pay->>'reference', ''));
  end loop;

  -- charge to patient bill
  if v_bill > 0 then
    insert into invoices (patient_id, created_by, notes)
    values (p_patient_id, auth.uid(), 'Pharmacy ' || v_sale_no) returning id into v_inv;
    insert into invoice_items (invoice_id, category, description, quantity, unit_price)
    values (v_inv, 'pharmacy', 'Pharmacy sale ' || v_sale_no, 1, v_bill);
  end if;

  update pharmacy_sales set
    subtotal = v_sub, discount = p_discount, tax = v_tax, total = v_total,
    change_given = v_paid - v_total, invoice_id = v_inv,
    payment_method = (select case when count(distinct method) > 1 then 'split' else min(method) end
                        from pharmacy_sale_payments where sale_id = v_sale)
   where id = v_sale;

  return json_build_object('sale_id', v_sale, 'sale_no', v_sale_no, 'total', v_total,
                           'change', v_paid - v_total, 'invoice_id', v_inv);
end $$;

-- ---------- Returns / refunds ----------
-- p_items: [{"sale_item_id": "...", "quantity": 1, "restock": true}]
create or replace function pos_refund(
  p_sale uuid,
  p_items jsonb,
  p_method text,
  p_reason text default null,
  p_reference text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_shift uuid := my_open_shift();
  v_sale pharmacy_sales; v_ret uuid; v_ret_no text;
  v_item jsonb; v_si pharmacy_sale_items; v_qty int; v_done int; v_amt numeric; v_total numeric := 0;
  v_ratio numeric; v_restock boolean; v_sold int; v_returned int;
begin
  if not has_role(array['pharmacist','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  if v_shift is null then raise exception 'Open a shift before processing returns'; end if;
  select * into v_sale from pharmacy_sales where id = p_sale for update;
  if not found then raise exception 'Sale not found'; end if;
  if p_method = 'bill' and v_sale.invoice_id is null then raise exception 'This sale was not charged to a patient bill'; end if;

  -- refunds are pro-rated so discount and tax are returned proportionally
  v_ratio := case when v_sale.subtotal > 0 then v_sale.total / v_sale.subtotal else 0 end;

  insert into pharmacy_returns (sale_id, shift_id, refund_method, reason, reference, created_by)
  values (p_sale, v_shift, p_method, p_reason, p_reference, auth.uid())
  returning id, return_no into v_ret, v_ret_no;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty <= 0 then continue; end if;
    select * into v_si from pharmacy_sale_items where id = (v_item->>'sale_item_id')::uuid and sale_id = p_sale;
    if not found then raise exception 'Item does not belong to this sale'; end if;
    select coalesce(sum(quantity),0) into v_returned from pharmacy_return_items where sale_item_id = v_si.id;
    if v_qty > v_si.quantity - v_returned then
      raise exception 'Only % left to return for this item', v_si.quantity - v_returned;
    end if;
    v_restock := coalesce((v_item->>'restock')::boolean, true);
    v_amt := round(v_qty * v_si.unit_price * v_ratio, 2);
    insert into pharmacy_return_items (return_id, sale_item_id, quantity, amount, restocked)
    values (v_ret, v_si.id, v_qty, v_amt, v_restock);
    if v_restock and v_si.batch_id is not null then
      update medicine_batches set quantity = quantity + v_qty where id = v_si.batch_id;
    end if;
    v_total := v_total + v_amt;
  end loop;

  if v_total <= 0 then raise exception 'Select at least one item to return'; end if;
  -- never refund more than was paid
  v_total := least(v_total, v_sale.total - v_sale.refunded_total);
  update pharmacy_returns set total = v_total where id = v_ret;

  if p_method = 'bill' then
    insert into invoice_items (invoice_id, category, description, quantity, unit_price)
    values (v_sale.invoice_id, 'pharmacy', 'Return ' || v_ret_no || ' for ' || v_sale.sale_no, 1, -v_total);
  end if;

  select coalesce(sum(quantity),0) into v_sold from pharmacy_sale_items where sale_id = p_sale;
  select coalesce(sum(ri.quantity),0) into v_returned
    from pharmacy_return_items ri join pharmacy_sale_items si on si.id = ri.sale_item_id where si.sale_id = p_sale;

  update pharmacy_sales set
    refunded_total = refunded_total + v_total,
    status = case when v_returned >= v_sold then 'refunded' else 'partially_refunded' end
   where id = p_sale;

  return json_build_object('return_id', v_ret, 'return_no', v_ret_no, 'total', v_total);
end $$;

-- ---------- Shift summary & close (Z-report) ----------
create or replace function pos_shift_summary(p_shift uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_s pos_shifts; v json;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select * into v_s from pos_shifts where id = p_shift;
  if not found then raise exception 'Shift not found'; end if;
  select json_build_object(
    'shift_no', v_s.shift_no,
    'opened_at', v_s.opened_at,
    'closed_at', v_s.closed_at,
    'opening_cash', v_s.opening_cash,
    'sales_count', (select count(*) from pharmacy_sales where shift_id = p_shift),
    'gross_sales', (select coalesce(sum(total),0) from pharmacy_sales where shift_id = p_shift),
    'discounts', (select coalesce(sum(discount),0) from pharmacy_sales where shift_id = p_shift),
    'tax', (select coalesce(sum(tax),0) from pharmacy_sales where shift_id = p_shift),
    'payments', (select coalesce(json_object_agg(method, amt), '{}'::json) from (
        select p.method, sum(p.amount) amt from pharmacy_sale_payments p
          join pharmacy_sales s on s.id = p.sale_id where s.shift_id = p_shift group by p.method) x),
    'returns_count', (select count(*) from pharmacy_returns where shift_id = p_shift),
    'refunds', (select coalesce(json_object_agg(refund_method, amt), '{}'::json) from (
        select refund_method, sum(total) amt from pharmacy_returns where shift_id = p_shift group by refund_method) x),
    'cash_in', (select coalesce(sum(amount),0) from pos_cash_movements where shift_id = p_shift and movement_type = 'in'),
    'cash_out', (select coalesce(sum(amount),0) from pos_cash_movements where shift_id = p_shift and movement_type = 'out'),
    'movements', (select coalesce(json_agg(json_build_object('type', movement_type, 'amount', amount, 'reason', reason, 'at', created_at) order by created_at), '[]'::json)
                    from pos_cash_movements where shift_id = p_shift),
    'expected_cash', v_s.opening_cash
        + (select coalesce(sum(p.amount),0) from pharmacy_sale_payments p join pharmacy_sales s on s.id = p.sale_id
            where s.shift_id = p_shift and p.method = 'cash')
        - (select coalesce(sum(total),0) from pharmacy_returns where shift_id = p_shift and refund_method = 'cash')
        + (select coalesce(sum(amount),0) from pos_cash_movements where shift_id = p_shift and movement_type = 'in')
        - (select coalesce(sum(amount),0) from pos_cash_movements where shift_id = p_shift and movement_type = 'out')
  ) into v;
  return v;
end $$;

create or replace function pos_close_shift(p_counted_cash numeric, p_notes text default null) returns json
language plpgsql security definer set search_path = public as $$
declare v_shift uuid := my_open_shift(); v_sum json; v_expected numeric;
begin
  if v_shift is null then raise exception 'No open shift'; end if;
  v_sum := pos_shift_summary(v_shift);
  v_expected := (v_sum->>'expected_cash')::numeric;
  update pos_shifts set status = 'closed', closed_at = now(), expected_cash = v_expected,
         counted_cash = p_counted_cash, difference = p_counted_cash - v_expected, notes = p_notes,
         summary = v_sum
   where id = v_shift;
  return pos_shift_summary(v_shift);
end $$;

-- ---------- RLS for new tables ----------
do $$
declare t text;
begin
  foreach t in array array['pos_shifts','pos_cash_movements','pharmacy_sale_payments','pharmacy_returns','pharmacy_return_items'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_read on %I', t);
    execute format('drop policy if exists staff_write on %I', t);
    execute format('create policy staff_read on %I for select to authenticated using (has_role(%L::user_role[]))', t, '{pharmacist,receptionist,accountant}');
    -- writes go through the security-definer functions above; only admin writes directly
    execute format('create policy staff_write on %I for all to authenticated using (has_role(%L::user_role[])) with check (has_role(%L::user_role[]))', t, '{}', '{}');
  end loop;
end $$;

-- sales and sale items: changes only through pos_checkout / pos_refund
drop policy if exists staff_write on pharmacy_sales;
create policy staff_write on pharmacy_sales for all to authenticated using (has_role('{}'::user_role[])) with check (has_role('{}'::user_role[]));
drop policy if exists staff_write on pharmacy_sale_items;
create policy staff_write on pharmacy_sale_items for all to authenticated using (has_role('{}'::user_role[])) with check (has_role('{}'::user_role[]));

do $$
declare t text;
begin
  foreach t in array array['pos_shifts','pharmacy_returns','pharmacy_sale_payments'] loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function trg_audit()', t);
  end loop;
end $$;

-- ---------- Dashboard: pharmacy revenue = money actually taken, net of refunds ----------
-- (amounts charged to a patient bill are counted when that bill is paid)
drop view if exists pharmacy_daily_revenue cascade;
create view pharmacy_daily_revenue with (security_invoker = true) as
select day, sum(amount) as amount from (
  select p.created_at::date as day, p.amount from pharmacy_sale_payments p where p.method <> 'bill'
  union all
  select r.created_at::date, -r.total from pharmacy_returns r where r.refund_method <> 'bill'
) x group by day;

create or replace function dashboard_stats() returns json
language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select json_build_object(
    'appointments_today', (select count(*) from appointments where scheduled_at::date = current_date and status <> 'cancelled'),
    'waiting', (select count(*) from appointments where scheduled_at::date = current_date and status = 'checked_in'),
    'admitted', (select count(*) from admissions where status = 'admitted'),
    'beds_total', (select count(*) from beds),
    'beds_available', (select count(*) from beds where status = 'available'),
    'revenue_today', (select coalesce(sum(amount),0) from payments where created_at::date = current_date)
                    + (select coalesce(sum(amount),0) from pharmacy_daily_revenue where day = current_date)
                    + (select coalesce(sum(total),0) from orders where created_at::date = current_date and status not in ('pending','cancelled')),
    'outstanding', (select coalesce(sum(total - amount_paid),0) from invoices where status in ('unpaid','partial')),
    'low_stock', (select count(*) from medicine_stock where active and stock <= reorder_level),
    'expiring', (select count(*) from expiring_batches),
    'pending_labs', (select count(*) from lab_orders where status in ('ordered','collected','processing')),
    'new_leads', (select count(*) from leads where status = 'new'),
    'pending_orders', (select count(*) from orders where status in ('paid','processing')),
    'patients_total', (select count(*) from patients),
    'open_shifts', (select count(*) from pos_shifts where status = 'open'),
    'revenue_30d', (
      select coalesce(json_agg(json_build_object('day', d::date, 'amount', coalesce(x.amt,0)) order by d), '[]'::json)
        from generate_series(current_date - 29, current_date, interval '1 day') d
        left join (
          select day, sum(amt) amt from (
            select created_at::date as day, amount as amt from payments
            union all
            select day, amount from pharmacy_daily_revenue
            union all
            select created_at::date, total from orders where status not in ('pending','cancelled')
          ) y group by day
        ) x on x.day = d::date
    ),
    'revenue_by_category', (
      select coalesce(json_agg(json_build_object('category', category, 'amount', amt)), '[]'::json) from (
       select category, sum(amt) amt from (
        select ii.category, sum(ii.line_total) amt from invoice_items ii
          join invoices i on i.id = ii.invoice_id
         where i.created_at >= current_date - 30 and i.status <> 'void'
         group by 1
        union all
        select 'pharmacy', coalesce(sum(amount),0) from pharmacy_daily_revenue where day >= current_date - 30
        union all
        select 'store', coalesce(sum(total),0) from orders where created_at >= current_date - 30 and status not in ('pending','cancelled')
       ) u group by category
      ) t
    )
  ) into v;
  return v;
end $$;
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
-- =====================================================================
-- CarePlus HMS
-- 06: Advanced modules
--   Security (staff MFA enforcement, idle logout setting), multi-branch,
--   emergency triage, blood bank, referrals, immunizations, diet & kitchen,
--   ambulance, patient <-> care team messaging, prescription refills,
--   patient document uploads, lab interface log, scheduled reports.
-- Safe to run on an existing install (idempotent). Run after 05.
-- =====================================================================

-- =====================================================================
-- 0. Security settings
-- =====================================================================
insert into settings (key, value) values ('security', '{"require_staff_mfa": false, "idle_minutes": 15}')
on conflict (key) do nothing;

drop policy if exists public_read_security on settings;
create policy public_read_security on settings for select to authenticated using (key = 'security');

-- When "require staff MFA" is on, staff sessions must be verified with an authenticator app (aal2)
create or replace function mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select (value->>'require_staff_mfa')::boolean from settings where key = 'security'), false)
      or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role <> 'patient' from profiles where id = auth.uid()), false) and mfa_ok()
$$;

create or replace function has_role(roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or role = any(roles) from profiles where id = auth.uid()), false) and mfa_ok()
$$;

-- =====================================================================
-- 1. Multi-branch
-- =====================================================================
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,
  address text,
  phone text,
  timezone text not null default 'America/Chicago',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into branches (name, code, address, phone)
select 'Main Campus', 'MAIN', '1200 Wellness Ave, Austin, TX 78701', '(555) 010-2000'
where not exists (select 1 from branches);

create or replace function main_branch() returns uuid
language sql stable security definer set search_path = public as $$
  select id from branches order by created_at limit 1
$$;

alter table profiles add column if not exists branch_id uuid references branches(id) on delete set null;

create or replace function current_branch() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select p.branch_id from profiles p join branches b on b.id = p.branch_id and b.active where p.id = auth.uid()), main_branch())
$$;

-- tables that belong to a branch
do $$
declare t text;
begin
  foreach t in array array['doctors','wards','staff','appointments','admissions','invoices','pharmacy_sales','pos_shifts',
                           'medicine_batches','inventory_items','lab_orders','ot_schedules'] loop
    execute format('alter table %I add column if not exists branch_id uuid references branches(id) on delete set null', t);
    execute format('update %I set branch_id = main_branch() where branch_id is null', t);
    execute format('create index if not exists %1$s_branch_idx on %1$I(branch_id)', t);
  end loop;
end $$;

-- new rows default to: the doctor's branch (appointments), the bed's branch (admissions), else the user's current branch
create or replace function trg_set_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    if tg_table_name = 'appointments' then
      select branch_id into new.branch_id from doctors where id = new.doctor_id;
    elsif tg_table_name = 'admissions' then
      select w.branch_id into new.branch_id from beds b join wards w on w.id = b.ward_id where b.id = new.bed_id;
    elsif tg_table_name = 'pharmacy_sales' then
      select branch_id into new.branch_id from pos_shifts where id = new.shift_id;
    end if;
    new.branch_id := coalesce(new.branch_id, current_branch());
  end if;
  return new;
end $$;

-- ---------- Stock is per branch: one helper does first-expiry-first-out within a branch ----------
create or replace function take_stock(p_medicine uuid, p_qty int, p_branch uuid)
returns table (batch_id uuid, qty int)
language plpgsql security definer set search_path = public as $$
declare v_need int := p_qty; b record; v_take int; v_name text;
begin
  if (select coalesce(sum(quantity),0) from medicine_batches
       where medicine_id = p_medicine and expiry_date >= current_date and (p_branch is null or branch_id = p_branch)) < p_qty then
    select name into v_name from medicines where id = p_medicine;
    raise exception 'Not enough stock for % at this branch', v_name;
  end if;
  for b in select id, quantity from medicine_batches
            where medicine_id = p_medicine and quantity > 0 and expiry_date >= current_date and (p_branch is null or branch_id = p_branch)
            order by expiry_date, received_at for update loop
    exit when v_need <= 0;
    v_take := least(v_need, b.quantity);
    update medicine_batches set quantity = quantity - v_take where id = b.id;
    batch_id := b.id; qty := v_take;
    return next;
    v_need := v_need - v_take;
  end loop;
end $$;

-- stock views now show the current branch
create or replace view medicine_stock with (security_invoker = true) as
select m.id, m.name, m.generic_name, m.category, m.form, m.strength, m.sku, m.barcode,
       m.price, m.cost, m.reorder_level, m.requires_prescription, m.active,
       coalesce(sum(b.quantity) filter (where b.expiry_date >= current_date and b.branch_id = current_branch()), 0)::int as stock,
       min(b.expiry_date) filter (where b.quantity > 0 and b.expiry_date >= current_date and b.branch_id = current_branch()) as next_expiry
  from medicines m left join medicine_batches b on b.medicine_id = m.id
 group by m.id;

drop view if exists expiring_batches;
create view expiring_batches with (security_invoker = true) as
select b.*, m.name as medicine_name
  from medicine_batches b join medicines m on m.id = b.medicine_id
 where b.quantity > 0 and b.expiry_date <= current_date + 60 and b.branch_id = current_branch()
 order by b.expiry_date;

-- ---------- POS checkout, ward medication and OT consumables use branch stock ----------
create or replace function pos_checkout(
  p_items jsonb, p_payments jsonb, p_patient_id uuid default null,
  p_discount numeric default 0, p_tax_rate numeric default 0, p_rx_note text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_shift uuid := my_open_shift(); v_branch uuid;
  v_sale uuid; v_sale_no text; v_item jsonb; v_med medicines; s record;
  v_sub numeric := 0; v_tax numeric; v_total numeric;
  v_pay jsonb; v_paid numeric := 0; v_cash numeric := 0; v_change numeric := 0;
  v_bill numeric := 0; v_inv uuid; v_method text; v_amt numeric; v_x numeric;
begin
  if not has_role(array['pharmacist','receptionist']::user_role[]) then raise exception 'Not allowed'; end if;
  if v_shift is null then raise exception 'Open a shift before making sales'; end if;
  select branch_id into v_branch from pos_shifts where id = v_shift;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'Add a payment'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_med from medicines where id = (v_item->>'medicine_id')::uuid;
    if not found then raise exception 'Medicine not found'; end if;
    if v_med.requires_prescription and nullif(trim(coalesce(p_rx_note, '')), '') is null then
      if p_patient_id is null then
        raise exception '% needs a prescription. Link the patient or enter the prescription details.', v_med.name;
      elsif not patient_has_rx(p_patient_id, v_med.id) then
        raise exception 'No prescription on file for %. Enter the prescription details to continue.', v_med.name;
      end if;
    end if;
  end loop;

  insert into pharmacy_sales (patient_id, payment_method, cashier_id, shift_id, rx_note, branch_id)
  values (p_patient_id, 'split', auth.uid(), v_shift, nullif(trim(coalesce(p_rx_note, '')), ''), v_branch)
  returning id, sale_no into v_sale, v_sale_no;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_med from medicines where id = (v_item->>'medicine_id')::uuid;
    if coalesce((v_item->>'quantity')::int, 0) <= 0 then raise exception 'Invalid quantity for %', v_med.name; end if;
    for s in select * from take_stock(v_med.id, (v_item->>'quantity')::int, v_branch) loop
      insert into pharmacy_sale_items (sale_id, medicine_id, batch_id, quantity, unit_price, line_total)
      values (v_sale, v_med.id, s.batch_id, s.qty, v_med.price, s.qty * v_med.price);
      v_sub := v_sub + s.qty * v_med.price;
    end loop;
  end loop;

  p_discount := least(greatest(coalesce(p_discount, 0), 0), v_sub);
  v_tax := round((v_sub - p_discount) * coalesce(p_tax_rate, 0) / 100, 2);
  v_total := round(v_sub - p_discount + v_tax, 2);

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_amt := round(coalesce((v_pay->>'amount')::numeric, 0), 2);
    if v_amt <= 0 then continue; end if;
    v_paid := v_paid + v_amt;
    if v_pay->>'method' = 'cash' then v_cash := v_cash + v_amt; end if;
  end loop;
  if v_paid < v_total then raise exception 'Payment is short by %', to_char(v_total - v_paid, 'FM999990.00'); end if;
  v_change := v_paid - v_total;
  if v_change > v_cash then raise exception 'Only cash can be over-tendered. Reduce the card/insurance/bill amount.'; end if;

  for v_pay in select * from jsonb_array_elements(p_payments) loop
    v_method := v_pay->>'method';
    v_amt := round(coalesce((v_pay->>'amount')::numeric, 0), 2);
    if v_amt <= 0 then continue; end if;
    if v_method = 'cash' and v_change > 0 then
      v_x := least(v_amt, v_change); v_amt := v_amt - v_x; v_change := v_change - v_x;
      if v_amt <= 0 then continue; end if;
    end if;
    if v_method = 'bill' then
      if p_patient_id is null then raise exception 'Link a patient to charge their hospital bill'; end if;
      v_bill := v_bill + v_amt;
    end if;
    insert into pharmacy_sale_payments (sale_id, method, amount, reference) values (v_sale, v_method, v_amt, nullif(v_pay->>'reference', ''));
  end loop;

  if v_bill > 0 then
    insert into invoices (patient_id, created_by, notes, branch_id) values (p_patient_id, auth.uid(), 'Pharmacy ' || v_sale_no, v_branch) returning id into v_inv;
    insert into invoice_items (invoice_id, category, description, quantity, unit_price) values (v_inv, 'pharmacy', 'Pharmacy sale ' || v_sale_no, 1, v_bill);
  end if;

  update pharmacy_sales set subtotal = v_sub, discount = p_discount, tax = v_tax, total = v_total,
         change_given = v_paid - v_total, invoice_id = v_inv,
         payment_method = (select case when count(distinct method) > 1 then 'split' else min(method) end from pharmacy_sale_payments where sale_id = v_sale)
   where id = v_sale;

  return json_build_object('sale_id', v_sale, 'sale_no', v_sale_no, 'total', v_total, 'change', v_paid - v_total, 'invoice_id', v_inv);
end $$;

create or replace function mar_record(p_order uuid, p_scheduled timestamptz, p_status text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare o medication_orders; v_id uuid; v_batch uuid; v_branch uuid; s record;
begin
  if not has_role(array['nurse','doctor']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into o from medication_orders where id = p_order;
  if not found then raise exception 'Medication order not found'; end if;
  if o.status <> 'active' then raise exception 'This medication has been stopped'; end if;
  select branch_id into v_branch from admissions where id = o.admission_id and status = 'admitted';
  if not found then raise exception 'Patient is no longer admitted'; end if;
  if p_status in ('held','refused') and nullif(trim(coalesce(p_notes,'')), '') is null then
    raise exception 'Please add a reason when a dose is held or refused';
  end if;
  if p_status = 'given' and o.medicine_id is not null then
    for s in select * from take_stock(o.medicine_id, o.units_per_dose, v_branch) loop
      v_batch := coalesce(v_batch, s.batch_id);
    end loop;
  end if;
  insert into medication_administrations (order_id, admission_id, scheduled_for, status, given_by, batch_id, notes)
  values (p_order, o.admission_id, p_scheduled, p_status, auth.uid(), v_batch, nullif(trim(coalesce(p_notes,'')), ''))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'This dose has already been recorded';
end $$;

create or replace function ot_add_consumable(p_ot uuid, p_item uuid, p_medicine uuid, p_qty int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_price numeric := 0; v_branch uuid; s record;
begin
  if not has_role(array['doctor','nurse']::user_role[]) then raise exception 'Not allowed'; end if;
  select branch_id into v_branch from ot_schedules where id = p_ot;
  if (select invoice_id from ot_schedules where id = p_ot) is not null then raise exception 'This surgery has already been billed'; end if;
  if p_item is not null then
    select name, unit_price into v_name, v_price from inventory_items where id = p_item;
    insert into inventory_transactions (item_id, txn_type, quantity, note, created_by) values (p_item, 'out', p_qty, 'Used in OT', auth.uid());
  elsif p_medicine is not null then
    select name || coalesce(' ' || strength, ''), price into v_name, v_price from medicines where id = p_medicine;
    perform * from take_stock(p_medicine, p_qty, v_branch);
  else
    raise exception 'Choose an item or medicine';
  end if;
  insert into ot_consumables (ot_id, inventory_item_id, medicine_id, name, quantity, unit_price, created_by)
  values (p_ot, p_item, p_medicine, v_name, p_qty, coalesce(v_price, 0), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- pharmacy revenue per branch
drop view if exists pharmacy_daily_revenue cascade;
create view pharmacy_daily_revenue with (security_invoker = true) as
select day, branch_id, sum(amount) as amount from (
  select p.created_at::date as day, s.branch_id, p.amount from pharmacy_sale_payments p join pharmacy_sales s on s.id = p.sale_id where p.method <> 'bill'
  union all
  select r.created_at::date, s.branch_id, -r.total from pharmacy_returns r join pharmacy_sales s on s.id = r.sale_id where r.refund_method <> 'bill'
) x group by day, branch_id;

-- dashboard for the current branch
create or replace function dashboard_stats() returns json
language plpgsql stable security definer set search_path = public as $$
declare v json; br uuid := current_branch();
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select json_build_object(
    'branch', (select name from branches where id = br),
    'appointments_today', (select count(*) from appointments where branch_id = br and scheduled_at::date = current_date and status <> 'cancelled'),
    'waiting', (select count(*) from appointments where branch_id = br and scheduled_at::date = current_date and status = 'checked_in'),
    'admitted', (select count(*) from admissions where branch_id = br and status = 'admitted'),
    'beds_total', (select count(*) from beds b join wards w on w.id = b.ward_id where w.branch_id = br),
    'beds_available', (select count(*) from beds b join wards w on w.id = b.ward_id where w.branch_id = br and b.status = 'available'),
    'er_waiting', (select count(*) from er_visits where branch_id = br and status in ('waiting','in_treatment')),
    'revenue_today', (select coalesce(sum(p.amount),0) from payments p join invoices i on i.id = p.invoice_id where i.branch_id = br and p.created_at::date = current_date)
                    + (select coalesce(sum(amount),0) from pharmacy_daily_revenue where branch_id = br and day = current_date)
                    + (select coalesce(sum(total),0) from orders where created_at::date = current_date and status not in ('pending','cancelled')),
    'outstanding', (select coalesce(sum(total - amount_paid),0) from invoices where branch_id = br and status in ('unpaid','partial')),
    'low_stock', (select count(*) from medicine_stock where active and stock <= reorder_level),
    'expiring', (select count(*) from expiring_batches),
    'pending_labs', (select count(*) from lab_orders where branch_id = br and status in ('ordered','collected','processing')),
    'new_leads', (select count(*) from leads where status = 'new'),
    'pending_orders', (select count(*) from orders where status in ('paid','processing')),
    'patients_total', (select count(*) from patients),
    'open_shifts', (select count(*) from pos_shifts where branch_id = br and status = 'open'),
    'unread_messages', (select count(*) from patient_messages where sender_type = 'patient' and read_by_staff_at is null),
    'pending_refills', (select count(*) from refill_requests where status = 'requested'),
    'blood_low', (select count(*) from (select g from unnest(array['A+','A-','B+','B-','AB+','AB-','O+','O-']) g
                    where (select count(*) from blood_units u where u.blood_group = g and u.status = 'available' and u.expires_on >= current_date) < 2) x),
    'revenue_30d', (
      select coalesce(json_agg(json_build_object('day', d::date, 'amount', coalesce(x.amt,0)) order by d), '[]'::json)
        from generate_series(current_date - 29, current_date, interval '1 day') d
        left join (
          select day, sum(amt) amt from (
            select p.created_at::date as day, p.amount as amt from payments p join invoices i on i.id = p.invoice_id where i.branch_id = br
            union all select day, amount from pharmacy_daily_revenue where branch_id = br
            union all select created_at::date, total from orders where status not in ('pending','cancelled')
          ) y group by day
        ) x on x.day = d::date
    ),
    'revenue_by_category', (
      select coalesce(json_agg(json_build_object('category', category, 'amount', amt)), '[]'::json) from (
        select category, sum(amt) amt from (
          select ii.category, ii.line_total amt from invoice_items ii join invoices i on i.id = ii.invoice_id
           where i.branch_id = br and i.created_at >= current_date - 30 and i.status <> 'void'
          union all select 'pharmacy', amount from pharmacy_daily_revenue where branch_id = br and day >= current_date - 30
          union all select 'store', total from orders where created_at >= current_date - 30 and status not in ('pending','cancelled')
        ) u group by category
      ) t
    )
  ) into v;
  return v;
end $$;

-- =====================================================================
-- 2. Emergency department (triage)
-- =====================================================================
create sequence if not exists er_seq start 1001;
create table if not exists er_visits (
  id uuid primary key default gen_random_uuid(),
  er_no text not null unique default ('ER-' || nextval('er_seq')),
  patient_id uuid not null references patients(id) on delete cascade,
  arrived_at timestamptz not null default now(),
  arrival_mode text not null default 'walk_in' check (arrival_mode in ('walk_in','ambulance','police','transfer')),
  chief_complaint text not null,
  triage_level int check (triage_level between 1 and 5),     -- ESI: 1 resuscitation ... 5 non-urgent
  vitals jsonb not null default '{}'::jsonb,
  pain_score int check (pain_score between 0 and 10),
  area text,                                                   -- Bay 1, Trauma 2, Hallway...
  doctor_id uuid references doctors(id) on delete set null,
  triaged_by uuid references profiles(id),
  triaged_at timestamptz,
  seen_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting','in_treatment','admitted','discharged','transferred','left')),
  disposition_notes text,
  disposition_at timestamptz,
  admission_id uuid references admissions(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 3. Blood bank
-- =====================================================================
create sequence if not exists blood_req_seq start 101;
create table if not exists blood_donors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  blood_group text not null check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  phone text, email text, dob date,
  last_donation date,
  eligible boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists blood_units (
  id uuid primary key default gen_random_uuid(),
  unit_no text not null unique,
  blood_group text not null check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  component text not null default 'Packed red cells' check (component in ('Whole blood','Packed red cells','Plasma','Platelets','Cryoprecipitate')),
  volume_ml int default 350,
  collected_on date not null default current_date,
  expires_on date not null,
  status text not null default 'available' check (status in ('available','reserved','issued','discarded')),
  donor_id uuid references blood_donors(id) on delete set null,
  request_id uuid,
  branch_id uuid references branches(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists blood_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique default ('BR-' || nextval('blood_req_seq')),
  patient_id uuid not null references patients(id) on delete cascade,
  blood_group text not null check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  component text not null default 'Packed red cells',
  units_needed int not null default 1 check (units_needed > 0),
  urgency text not null default 'routine' check (urgency in ('routine','urgent','emergency')),
  indication text,
  status text not null default 'pending' check (status in ('pending','crossmatched','issued','cancelled')),
  crossmatch_result text,
  requested_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
do $$ begin
  alter table blood_units add constraint blood_units_request_fk foreign key (request_id) references blood_requests(id) on delete set null;
exception when duplicate_object then null; end $$;

-- red cell compatibility (plasma uses the reverse rule)
create or replace function blood_compatible(p_donor text, p_recipient text, p_component text) returns boolean
language plpgsql immutable as $$
declare d_abo text := rtrim(p_donor, '+-'); r_abo text := rtrim(p_recipient, '+-');
        d_rh text := right(p_donor, 1); r_rh text := right(p_recipient, 1);
begin
  if p_component = 'Plasma' or p_component = 'Cryoprecipitate' then
    return (d_abo = 'AB') or (d_abo = r_abo) or (r_abo = 'O') or (d_abo = 'A' and r_abo = 'O') or (d_abo = 'B' and r_abo = 'O');
  end if;
  if p_component = 'Platelets' then return true; end if;   -- ABO-identical preferred; left to clinical judgement
  return (d_rh = '-' or r_rh = '+')
     and (d_abo = 'O' or d_abo = r_abo or r_abo = 'AB');
end $$;

create or replace function blood_issue(p_request uuid, p_units uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare r blood_requests; u blood_units; v_uid uuid; n int := 0;
begin
  if not has_role(array['lab_tech','nurse','doctor']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into r from blood_requests where id = p_request for update;
  if not found or r.status in ('issued','cancelled') then raise exception 'Request is not open'; end if;
  foreach v_uid in array p_units loop
    select * into u from blood_units where id = v_uid for update;
    if u.status <> 'available' then raise exception 'Unit % is not available', u.unit_no; end if;
    if u.expires_on < current_date then raise exception 'Unit % has expired', u.unit_no; end if;
    if u.component <> r.component then raise exception 'Unit % is %, request needs %', u.unit_no, u.component, r.component; end if;
    if not blood_compatible(u.blood_group, r.blood_group, r.component) then
      raise exception 'Unit % (%) is not compatible with % recipient', u.unit_no, u.blood_group, r.blood_group;
    end if;
    update blood_units set status = 'issued', request_id = p_request where id = u.id;
    n := n + 1;
  end loop;
  if (select count(*) from blood_units where request_id = p_request and status = 'issued') >= r.units_needed then
    update blood_requests set status = 'issued' where id = p_request;
  end if;
  return n;
end $$;

-- =====================================================================
-- 4. Referrals
-- =====================================================================
create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  from_doctor_id uuid references doctors(id) on delete set null,
  to_doctor_id uuid references doctors(id) on delete set null,
  external_to text,                         -- outside specialist / facility
  reason text not null,
  urgency text not null default 'routine' check (urgency in ('routine','urgent')),
  status text not null default 'pending' check (status in ('pending','accepted','scheduled','completed','declined')),
  response text,
  appointment_id uuid references appointments(id) on delete set null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- =====================================================================
-- 5. Immunizations
-- =====================================================================
create table if not exists vaccines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  cvx_code text,
  doses_required int not null default 1,
  interval_days int,                        -- days to next dose in the series
  booster_days int,                         -- days to booster after the series (e.g. 365 for flu)
  notes text
);

create table if not exists immunizations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  vaccine_id uuid not null references vaccines(id),
  dose_number int not null default 1,
  given_on date not null default current_date,
  lot_number text, manufacturer text,
  site text, route text default 'IM',
  given_by uuid references profiles(id),
  next_due_on date,
  notes text,
  created_at timestamptz not null default now()
);

create or replace function trg_immunization_due() returns trigger
language plpgsql security definer set search_path = public as $$
declare v vaccines;
begin
  if new.next_due_on is null then
    select * into v from vaccines where id = new.vaccine_id;
    new.next_due_on := case
      when new.dose_number < v.doses_required and v.interval_days is not null then new.given_on + v.interval_days
      when new.dose_number >= v.doses_required and v.booster_days is not null then new.given_on + v.booster_days
      else null end;
  end if;
  return new;
end $$;
drop trigger if exists immunization_due on immunizations;
create trigger immunization_due before insert on immunizations for each row execute function trg_immunization_due();

insert into vaccines (name, cvx_code, doses_required, interval_days, booster_days, notes) values
  ('Influenza (seasonal)', '141', 1, null, 365, 'Yearly'),
  ('COVID-19', '213', 1, null, 365, 'Follow current CDC guidance'),
  ('Tdap', '115', 1, null, 3650, 'Td/Tdap booster every 10 years'),
  ('Hepatitis B', '08', 3, 30, null, '0, 1 and 6 months'),
  ('Hepatitis A', '83', 2, 180, null, '2 doses 6 months apart'),
  ('MMR', '03', 2, 28, null, ''),
  ('Varicella', '21', 2, 28, null, ''),
  ('HPV', '165', 2, 180, null, '2 or 3 doses depending on age'),
  ('Pneumococcal (PCV20)', '216', 1, null, null, ''),
  ('Shingles (RZV)', '187', 2, 60, null, '2 doses 2 to 6 months apart'),
  ('RSV (adult)', '305', 1, null, null, ''),
  ('Meningococcal ACWY', '147', 2, 1460, null, ''),
  ('DTaP (pediatric)', '20', 5, 60, null, ''),
  ('Polio (IPV)', '10', 4, 60, null, ''),
  ('Hib', '17', 4, 60, null, ''),
  ('Rotavirus', '116', 3, 60, null, '')
on conflict (name) do nothing;

-- =====================================================================
-- 6. Diet & kitchen
-- =====================================================================
create table if not exists diet_orders (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions(id) on delete cascade,
  diet_type text not null default 'Regular',     -- Regular, Diabetic, Low sodium, Cardiac, Renal, Soft, Clear liquid, Full liquid, NPO
  texture text,
  fluid_limit_ml int,
  food_allergies text,
  instructions text,
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active','stopped')),
  ordered_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists meal_service (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions(id) on delete cascade,
  diet_order_id uuid references diet_orders(id) on delete set null,
  meal text not null check (meal in ('breakfast','lunch','dinner','snack')),
  service_date date not null default current_date,
  status text not null check (status in ('served','refused','held')),
  notes text,
  served_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (admission_id, meal, service_date)
);

-- only one active diet per admission: a new order stops the previous one
create or replace function trg_one_active_diet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update diet_orders set status = 'stopped' where admission_id = new.admission_id and status = 'active' and id <> new.id;
  return new;
end $$;
drop trigger if exists one_active_diet on diet_orders;
create trigger one_active_diet after insert on diet_orders for each row execute function trg_one_active_diet();

-- =====================================================================
-- 7. Ambulance
-- =====================================================================
create sequence if not exists trip_seq start 301;
create table if not exists ambulances (
  id uuid primary key default gen_random_uuid(),
  vehicle_no text not null unique,
  vehicle_type text not null default 'BLS' check (vehicle_type in ('BLS','ALS','Patient transport')),
  status text not null default 'available' check (status in ('available','on_trip','maintenance')),
  driver_name text, driver_phone text,
  branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists ambulance_trips (
  id uuid primary key default gen_random_uuid(),
  trip_no text not null unique default ('AMB-' || nextval('trip_seq')),
  patient_id uuid references patients(id) on delete set null,
  caller_name text not null,
  caller_phone text not null,
  pickup_address text not null,
  destination text,
  trip_type text not null default 'transfer' check (trip_type in ('emergency','transfer','discharge','appointment')),
  priority text not null default 'normal' check (priority in ('normal','urgent','critical')),
  scheduled_for timestamptz,
  status text not null default 'requested' check (status in ('requested','dispatched','at_pickup','transporting','completed','cancelled')),
  ambulance_id uuid references ambulances(id) on delete set null,
  dispatched_at timestamptz, at_pickup_at timestamptz, transporting_at timestamptz, completed_at timestamptz,
  charge numeric(10,2) not null default 0,
  invoice_id uuid references invoices(id) on delete set null,
  notes text,
  source text not null default 'phone' check (source in ('phone','web','er')),
  branch_id uuid references branches(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function trip_set_status(p_trip uuid, p_status text, p_ambulance uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare t ambulance_trips;
begin
  if not has_role(array['receptionist','nurse']::user_role[]) then raise exception 'Not allowed'; end if;
  select * into t from ambulance_trips where id = p_trip for update;
  if p_status = 'dispatched' then
    if coalesce(p_ambulance, t.ambulance_id) is null then raise exception 'Choose an ambulance'; end if;
    update ambulances set status = 'on_trip' where id = coalesce(p_ambulance, t.ambulance_id) and status = 'available';
    if not found then raise exception 'That ambulance is not available'; end if;
    update ambulance_trips set status = 'dispatched', ambulance_id = coalesce(p_ambulance, t.ambulance_id), dispatched_at = now() where id = p_trip;
  elsif p_status in ('at_pickup','transporting') then
    execute format('update ambulance_trips set status = %L, %I = now() where id = %L', p_status, p_status || '_at', p_trip);
  elsif p_status in ('completed','cancelled') then
    update ambulance_trips set status = p_status, completed_at = case when p_status = 'completed' then now() end where id = p_trip;
    update ambulances set status = 'available' where id = t.ambulance_id;
    if p_status = 'completed' and t.charge > 0 and t.patient_id is not null and t.invoice_id is null then
      insert into invoices (patient_id, notes, created_by) values (t.patient_id, 'Ambulance ' || t.trip_no, auth.uid()) returning id into t.invoice_id;
      insert into invoice_items (invoice_id, category, description, quantity, unit_price, code)
      values (t.invoice_id, 'other', 'Ambulance transport ' || t.trip_no, 1, t.charge, 'A0428');
      update ambulance_trips set invoice_id = t.invoice_id where id = p_trip;
    end if;
  else
    raise exception 'Unknown status';
  end if;
end $$;

-- public: request non-emergency transport from the website
create or replace function request_transport(p_name text, p_phone text, p_pickup text, p_destination text, p_when timestamptz, p_notes text)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_phone),'') = '' or coalesce(trim(p_pickup),'') = '' then
    raise exception 'Name, phone and pickup address are required';
  end if;
  insert into ambulance_trips (caller_name, caller_phone, pickup_address, destination, scheduled_for, notes, source, trip_type, branch_id)
  values (p_name, p_phone, p_pickup, p_destination, p_when, p_notes, 'web', 'transfer', main_branch())
  returning trip_no into v;
  return v;
end $$;
grant execute on function request_transport(text, text, text, text, timestamptz, text) to anon, authenticated;

-- =====================================================================
-- 8. Patient <-> care team messaging, refills, uploads
-- =====================================================================
create table if not exists patient_messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,    -- null = general care team
  sender_id uuid references profiles(id),
  sender_type text not null check (sender_type in ('patient','staff')),
  body text not null check (length(trim(body)) > 0),
  read_by_patient_at timestamptz,
  read_by_staff_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists patient_messages_idx on patient_messages(patient_id, created_at);

create or replace function messages_mark_read(p_patient uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_patient_id() = p_patient then
    update patient_messages set read_by_patient_at = now() where patient_id = p_patient and sender_type = 'staff' and read_by_patient_at is null;
  elsif is_staff() then
    update patient_messages set read_by_staff_at = now() where patient_id = p_patient and sender_type = 'patient' and read_by_staff_at is null;
  end if;
end $$;

create table if not exists refill_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  prescription_id uuid references prescriptions(id) on delete set null,
  medicine_id uuid references medicines(id) on delete set null,
  medicine_name text not null,
  doctor_id uuid references doctors(id) on delete set null,
  note text,
  status text not null default 'requested' check (status in ('requested','approved','denied','dispensed')),
  response text,
  responded_by uuid references profiles(id),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

-- an approved refill (last 30 days) counts as a prescription at the pharmacy counter
create or replace function patient_has_rx(p_patient uuid, p_medicine uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from prescriptions p join visits v on v.id = p.visit_id join medicines m on m.id = p_medicine
     where v.patient_id = p_patient and v.created_at > now() - interval '180 days'
       and (p.medicine_id = p_medicine or p.medicine_name ilike m.name || '%')
  ) or exists (
    select 1 from refill_requests r join medicines m on m.id = p_medicine
     where r.patient_id = p_patient and r.status = 'approved' and r.responded_at > now() - interval '30 days'
       and (r.medicine_id = p_medicine or r.medicine_name ilike m.name || '%')
  )
$$;

-- =====================================================================
-- 9. Lab interface log + scheduled reports
-- =====================================================================
create table if not exists lab_interface_log (
  id uuid primary key default gen_random_uuid(),
  source text,
  message text not null,
  status text not null check (status in ('applied','partial','rejected')),
  details text,
  lab_order_id uuid references lab_orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists report_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  frequency text not null default 'weekly' check (frequency in ('daily','weekly','monthly')),
  recipients text not null,                -- comma separated emails
  branch_id uuid references branches(id) on delete set null,   -- null = all branches
  active boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- RLS
-- =====================================================================
do $$
declare rec record;
begin
  for rec in select * from (values
    ('branches',          'admin_only'),
    ('er_visits',         'doctor,nurse,receptionist'),
    ('blood_donors',      'lab_tech,nurse'),
    ('blood_units',       'lab_tech'),
    ('blood_requests',    'doctor,nurse,lab_tech'),
    ('referrals',         'doctor,nurse,receptionist'),
    ('vaccines',          'admin_only'),
    ('immunizations',     'doctor,nurse'),
    ('diet_orders',       'doctor,nurse'),
    ('meal_service',      'nurse,receptionist'),
    ('ambulances',        'receptionist'),
    ('ambulance_trips',   'receptionist,nurse'),
    ('patient_messages',  'doctor,nurse,receptionist'),
    ('refill_requests',   'doctor'),
    ('lab_interface_log', 'admin_only'),
    ('report_schedules',  'accountant')
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

-- everyone signed in can see branch names (branch switcher, booking)
drop policy if exists public_read on branches;
create policy public_read on branches for select to anon, authenticated using (active);

-- patients: own immunizations, messages, refills, documents
drop policy if exists own_rows on immunizations;
create policy own_rows on immunizations for select to authenticated using (patient_id = my_patient_id());
drop policy if exists public_read on vaccines;
create policy public_read on vaccines for select to authenticated using (true);

drop policy if exists own_rows on patient_messages;
create policy own_rows on patient_messages for select to authenticated using (patient_id = my_patient_id());
drop policy if exists own_insert on patient_messages;
create policy own_insert on patient_messages for insert to authenticated
  with check (patient_id = my_patient_id() and sender_type = 'patient' and sender_id = auth.uid());

drop policy if exists own_rows on refill_requests;
create policy own_rows on refill_requests for select to authenticated using (patient_id = my_patient_id());
drop policy if exists own_insert on refill_requests;
create policy own_insert on refill_requests for insert to authenticated
  with check (patient_id = my_patient_id() and status = 'requested');

drop policy if exists own_insert on patient_documents;
create policy own_insert on patient_documents for insert to authenticated
  with check (patient_id = my_patient_id() and uploaded_by = auth.uid());

-- staff can always read/insert patient messages; doctors answer refills
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists "patients upload own documents" on storage.objects';
    execute 'create policy "patients upload own documents" on storage.objects for insert to authenticated
             with check (bucket_id = ''documents'' and (storage.foldername(name))[1] = public.my_patient_id()::text)';
  end if;
end $$;

-- branch default triggers
do $$
declare t text;
begin
  foreach t in array array['doctors','wards','staff','appointments','admissions','invoices','pharmacy_sales','pos_shifts',
                           'medicine_batches','inventory_items','lab_orders','ot_schedules','er_visits','blood_units','ambulances','ambulance_trips'] loop
    execute format('drop trigger if exists set_branch on %I', t);
    execute format('create trigger set_branch before insert on %I for each row execute function trg_set_branch()', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['er_visits','blood_units','blood_requests','referrals','immunizations','diet_orders','ambulance_trips','refill_requests','branches'] loop
    execute format('drop trigger if exists audit_%1$s on %1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function trg_audit()', t);
  end loop;
end $$;

-- realtime (live OPD queue, ER board, chat)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['appointments','er_visits','patient_messages','ambulance_trips'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;

-- demo data for the new modules (skipped if already present)
insert into ambulances (vehicle_no, vehicle_type, driver_name, driver_phone)
select * from (values ('AMB-01','ALS','Carlos Diaz','(555) 300-1001'), ('AMB-02','BLS','Megan Ross','(555) 300-1002'), ('VAN-01','Patient transport','Tom Baker','(555) 300-1003')) v
where not exists (select 1 from ambulances);

insert into blood_units (unit_no, blood_group, component, collected_on, expires_on)
select 'U' || lpad(g::text, 5, '0'), (array['O+','O+','A+','A+','B+','O-','AB+','A-','B-','O+','A+','O-'])[1 + (g % 12)],
       case when g % 5 = 0 then 'Plasma' else 'Packed red cells' end,
       current_date - (g % 20), current_date - (g % 20) + case when g % 5 = 0 then 365 else 42 end
from generate_series(1, 24) g
where not exists (select 1 from blood_units);
-- =====================================================================
-- CarePlus HMS
-- 03: Demo data (safe to skip in production)
-- =====================================================================

insert into settings (key, value) values
  ('hospital', '{"name":"CarePlus Hospital","phone":"(555) 010-2000","email":"hello@careplus.example","address":"1200 Wellness Ave, Austin, TX 78701","tax_rate":8.25,"currency":"USD","timezone":"America/Chicago"}')
on conflict (key) do nothing;

insert into departments (name, slug, description, icon) values
  ('Cardiology',      'cardiology',      'Heart health, ECG, echo and cardiac care.', 'HeartPulse'),
  ('Orthopedics',     'orthopedics',     'Bones, joints, sports injuries and spine.', 'Bone'),
  ('Pediatrics',      'pediatrics',      'Complete care for infants, children and teens.', 'Baby'),
  ('Neurology',       'neurology',       'Brain, nerves, headaches and stroke care.', 'Brain'),
  ('General Medicine','general-medicine','Primary care, checkups and chronic disease management.', 'Stethoscope'),
  ('Gynecology',      'gynecology',      'Women''s health, pregnancy and maternity care.', 'Flower2'),
  ('Dermatology',     'dermatology',     'Skin, hair and nail treatments.', 'Sparkles'),
  ('Emergency',       'emergency',       '24/7 emergency and trauma care.', 'Siren')
on conflict (slug) do nothing;

insert into staff (full_name, role, department_id, phone, email, pay_type, base_salary, hourly_rate, commission_pct)
select v.full_name, v.role::user_role, d.id, v.phone, v.email, v.pay_type, v.base_salary, v.hourly_rate, v.commission
from (values
  ('Dr. Sarah Mitchell','doctor','cardiology','(555) 201-1001','sarah.mitchell@careplus.example','salary',18000,0,20),
  ('Dr. James Carter','doctor','orthopedics','(555) 201-1002','james.carter@careplus.example','salary',17000,0,20),
  ('Dr. Emily Nguyen','doctor','pediatrics','(555) 201-1003','emily.nguyen@careplus.example','salary',15000,0,15),
  ('Dr. Michael Brooks','doctor','neurology','(555) 201-1004','michael.brooks@careplus.example','salary',18500,0,20),
  ('Dr. Olivia Patel','doctor','general-medicine','(555) 201-1005','olivia.patel@careplus.example','salary',13000,0,15),
  ('Dr. Rachel Kim','doctor','gynecology','(555) 201-1006','rachel.kim@careplus.example','salary',16000,0,15),
  ('Dr. Daniel Lopez','doctor','dermatology','(555) 201-1007','daniel.lopez@careplus.example','salary',14000,0,20),
  ('Dr. Aisha Rahman','doctor','emergency','(555) 201-1008','aisha.rahman@careplus.example','hourly',0,120,0),
  ('Linda Harris','nurse','emergency','(555) 202-2001','linda.harris@careplus.example','hourly',0,42,0),
  ('Kevin Moore','nurse','general-medicine','(555) 202-2002','kevin.moore@careplus.example','hourly',0,40,0),
  ('Jessica Taylor','receptionist','general-medicine','(555) 203-3001','jessica.taylor@careplus.example','hourly',0,22,0),
  ('Robert Chen','pharmacist',null,'(555) 204-4001','robert.chen@careplus.example','salary',10500,0,0),
  ('Maria Garcia','lab_tech',null,'(555) 205-5001','maria.garcia@careplus.example','hourly',0,30,0),
  ('Thomas Wright','accountant',null,'(555) 206-6001','thomas.wright@careplus.example','salary',7500,0,0)
) as v(full_name, role, dept, phone, email, pay_type, base_salary, hourly_rate, commission)
left join departments d on d.slug = v.dept
where not exists (select 1 from staff);

insert into doctors (staff_id, full_name, department_id, specialty, qualification, bio, consultation_fee, available_days, start_time, end_time, photo_url)
select s.id, s.full_name, s.department_id, v.specialty, v.qual, v.bio, v.fee, v.days::int[], v.st::time, v.et::time, v.photo
from (values
  ('Dr. Sarah Mitchell','Interventional Cardiologist','MD, FACC','15+ years treating complex heart conditions with a patient-first approach.',220,'{1,2,3,4,5}','09:00','16:00','https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=600&q=80'),
  ('Dr. James Carter','Orthopedic Surgeon','MD, FAAOS','Specialist in joint replacement and sports medicine.',200,'{1,2,4,5}','10:00','17:00','https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=600&q=80'),
  ('Dr. Emily Nguyen','Pediatrician','MD, FAAP','Gentle, family-centered care from newborns to teens.',150,'{1,2,3,4,5,6}','08:30','15:30','https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=600&q=80'),
  ('Dr. Michael Brooks','Neurologist','MD, PhD','Expert in migraine, epilepsy and stroke recovery.',230,'{2,3,4}','09:00','17:00','https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=600&q=80'),
  ('Dr. Olivia Patel','Family Physician','MD, ABFM','Preventive care, annual physicals and chronic disease management.',120,'{1,2,3,4,5}','08:00','16:00','https://images.unsplash.com/photo-1651008376811-b90baee60c1f?w=600&q=80'),
  ('Dr. Rachel Kim','OB/GYN','MD, FACOG','Compassionate women''s health and prenatal care.',180,'{1,3,5}','09:00','17:00','https://images.unsplash.com/photo-1527613426441-4da17471b66d?w=600&q=80'),
  ('Dr. Daniel Lopez','Dermatologist','MD, FAAD','Medical and cosmetic dermatology for all skin types.',170,'{2,4,6}','10:00','18:00','https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=600&q=80'),
  ('Dr. Aisha Rahman','Emergency Physician','MD, FACEP','Leads our 24/7 emergency department.',250,'{0,1,2,3,4,5,6}','00:00','23:40','https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=600&q=80')
) as v(name, specialty, qual, bio, fee, days, st, et, photo)
join staff s on s.full_name = v.name
where not exists (select 1 from doctors);

insert into wards (name, ward_type, daily_rate) values
  ('General Ward A', 'general', 450),
  ('Private Rooms', 'private', 950),
  ('ICU', 'icu', 2800),
  ('Maternity', 'maternity', 1200)
on conflict (name) do nothing;

insert into beds (ward_id, bed_no)
select w.id, prefix || '-' || lpad(g::text, 2, '0')
from wards w
cross join lateral (select case w.ward_type when 'general' then 'GA' when 'private' then 'PR' when 'icu' then 'ICU' else 'MT' end as prefix,
                           case w.ward_type when 'general' then 12 when 'private' then 6 when 'icu' then 6 else 6 end as n) x
cross join lateral generate_series(1, x.n) g
on conflict do nothing;

insert into suppliers (name, contact_person, phone, email) values
  ('McKesson Medical', 'Alan Price', '(800) 555-0101', 'orders@mckesson.example'),
  ('Cardinal Health', 'Nina Shaw', '(800) 555-0102', 'orders@cardinal.example')
on conflict do nothing;

insert into medicines (name, generic_name, category, form, strength, sku, barcode, price, cost, reorder_level, requires_prescription) values
  ('Tylenol Extra Strength', 'Acetaminophen', 'Pain Relief', 'Tablet', '500 mg', 'MED-001', '030045044905', 0.25, 0.08, 200, false),
  ('Advil', 'Ibuprofen', 'Pain Relief', 'Tablet', '200 mg', 'MED-002', '305730154406', 0.30, 0.10, 200, false),
  ('Amoxicillin', 'Amoxicillin', 'Antibiotic', 'Capsule', '500 mg', 'MED-003', '000000000003', 0.90, 0.30, 100, true),
  ('Azithromycin Z-Pak', 'Azithromycin', 'Antibiotic', 'Tablet', '250 mg', 'MED-004', '000000000004', 3.50, 1.20, 50, true),
  ('Lisinopril', 'Lisinopril', 'Cardiac', 'Tablet', '10 mg', 'MED-005', '000000000005', 0.60, 0.15, 100, true),
  ('Atorvastatin', 'Atorvastatin', 'Cardiac', 'Tablet', '20 mg', 'MED-006', '000000000006', 0.80, 0.20, 100, true),
  ('Metformin', 'Metformin', 'Diabetes', 'Tablet', '500 mg', 'MED-007', '000000000007', 0.40, 0.10, 150, true),
  ('Omeprazole', 'Omeprazole', 'Gastro', 'Capsule', '20 mg', 'MED-008', '000000000008', 0.70, 0.18, 100, false),
  ('Cetirizine', 'Cetirizine', 'Allergy', 'Tablet', '10 mg', 'MED-009', '000000000009', 0.35, 0.08, 100, false),
  ('Albuterol Inhaler', 'Albuterol', 'Respiratory', 'Inhaler', '90 mcg', 'MED-010', '000000000010', 28.00, 12.00, 20, true),
  ('Children''s Motrin', 'Ibuprofen', 'Pediatric', 'Syrup', '100 mg/5 mL', 'MED-011', '000000000011', 9.50, 4.00, 30, false),
  ('Insulin Glargine', 'Insulin', 'Diabetes', 'Injection', '100 U/mL', 'MED-012', '000000000012', 95.00, 60.00, 10, true),
  ('Saline IV 0.9%', 'Sodium Chloride', 'IV Fluids', 'IV Bag', '1000 mL', 'MED-013', '000000000013', 6.00, 2.50, 50, true),
  ('Vitamin D3', 'Cholecalciferol', 'Supplements', 'Softgel', '2000 IU', 'MED-014', '000000000014', 0.20, 0.05, 100, false),
  ('Ondansetron', 'Ondansetron', 'Gastro', 'Tablet', '4 mg', 'MED-015', '000000000015', 1.10, 0.30, 50, true)
on conflict (sku) do nothing;

insert into medicine_batches (medicine_id, batch_no, expiry_date, quantity, cost, supplier_id)
select m.id, 'B' || right(m.sku, 3) || '-A', current_date + 400, 500, m.cost, (select id from suppliers order by name limit 1)
from medicines m where not exists (select 1 from medicine_batches);
-- a few nearly-expiring / low batches for alerts
insert into medicine_batches (medicine_id, batch_no, expiry_date, quantity, cost)
select m.id, 'B' || right(m.sku, 3) || '-X', current_date + 25, 15, m.cost
from medicines m where m.sku in ('MED-004','MED-010')
  and not exists (select 1 from medicine_batches where batch_no like '%-X');
update medicine_batches set quantity = 6 where batch_no = 'B012-A';

insert into lab_tests (name, code, category, sample_type, normal_range, unit, price, turnaround_hours) values
  ('Complete Blood Count (CBC)', 'CBC', 'Hematology', 'Blood', 'See report', '', 45, 6),
  ('Comprehensive Metabolic Panel', 'CMP', 'Chemistry', 'Blood', 'See report', '', 65, 12),
  ('Lipid Panel', 'LIPID', 'Chemistry', 'Blood', 'Total < 200', 'mg/dL', 55, 12),
  ('Hemoglobin A1c', 'HBA1C', 'Chemistry', 'Blood', '4.0 - 5.6', '%', 40, 24),
  ('Thyroid Panel (TSH)', 'TSH', 'Endocrine', 'Blood', '0.4 - 4.0', 'mIU/L', 50, 24),
  ('Urinalysis', 'UA', 'Urine', 'Urine', 'Negative', '', 25, 4),
  ('Vitamin D, 25-Hydroxy', 'VITD', 'Chemistry', 'Blood', '30 - 100', 'ng/mL', 60, 48),
  ('COVID-19 PCR', 'COVID', 'Microbiology', 'Swab', 'Not detected', '', 90, 24),
  ('Chest X-Ray', 'CXR', 'Radiology', 'Imaging', 'Normal', '', 120, 2),
  ('ECG', 'ECG', 'Cardiology', 'Procedure', 'Normal sinus rhythm', '', 80, 1),
  ('Ultrasound Abdomen', 'USABD', 'Radiology', 'Imaging', 'Normal', '', 250, 4),
  ('MRI Brain', 'MRIB', 'Radiology', 'Imaging', 'Normal', '', 1200, 24)
on conflict (code) do nothing;

insert into products (name, slug, category, description, price, image_url, stock) values
  ('Digital Blood Pressure Monitor', 'bp-monitor', 'Devices', 'Clinically validated upper-arm monitor with memory for 2 users.', 49.99, 'https://images.unsplash.com/photo-1631815588090-d4bfec5b1ccb?w=800&q=80', 40),
  ('Pulse Oximeter', 'pulse-oximeter', 'Devices', 'Fingertip SpO2 and pulse rate monitor with OLED display.', 24.99, 'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&q=80', 60),
  ('Digital Thermometer', 'digital-thermometer', 'Devices', 'Fast 10-second reading, fever alert, waterproof tip.', 12.99, 'https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&q=80', 100),
  ('Vitamin D3 2000 IU (90 ct)', 'vitamin-d3', 'Supplements', 'Supports bone and immune health. One softgel daily.', 14.99, 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&q=80', 80),
  ('Daily Multivitamin (60 ct)', 'multivitamin', 'Supplements', 'Complete daily nutrition with 23 vitamins and minerals.', 19.99, 'https://images.unsplash.com/photo-1550572017-edd951b55104?w=800&q=80', 70),
  ('First Aid Kit (120 pcs)', 'first-aid-kit', 'First Aid', 'Home and travel first aid kit with essentials.', 29.99, 'https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=800&q=80', 35),
  ('N95 Masks (20 pack)', 'n95-masks', 'Protection', 'NIOSH-approved respirator masks.', 22.99, 'https://images.unsplash.com/photo-1586942593568-29361efcd571?w=800&q=80', 120),
  ('Annual Health Checkup Package', 'annual-checkup', 'Health Packages', 'Physical exam, CBC, CMP, lipid panel, A1c, urinalysis and ECG.', 299.00, 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=800&q=80', 999),
  ('Heart Health Package', 'heart-package', 'Health Packages', 'Cardiology consult, ECG, lipid panel and echo screening.', 449.00, 'https://images.unsplash.com/photo-1628348068343-c6a848d2b6dd?w=800&q=80', 999),
  ('Hand Sanitizer 500 mL', 'hand-sanitizer', 'Protection', '70% alcohol gel with aloe.', 7.99, 'https://images.unsplash.com/photo-1584483720412-ce931f4aefa8?w=800&q=80', 200)
on conflict (slug) do nothing;

insert into inventory_items (name, category, unit, quantity, reorder_level, location) values
  ('Surgical Gloves (box)', 'consumable', 'box', 180, 50, 'Central Store'),
  ('Syringes 5 mL', 'consumable', 'pcs', 2400, 500, 'Central Store'),
  ('Gauze Pads', 'consumable', 'pack', 320, 100, 'Central Store'),
  ('IV Cannula 20G', 'surgical', 'pcs', 60, 100, 'Emergency'),
  ('Wheelchair', 'equipment', 'pcs', 14, 4, 'Lobby'),
  ('Bed Sheets', 'linen', 'pcs', 400, 150, 'Laundry')
on conflict do nothing;

-- Sample patients + today's appointments
insert into patients (first_name, last_name, dob, gender, phone, email, city, state, blood_group, allergies, insurance_provider, insurance_member_id)
select * from (values
  ('John','Anderson','1978-04-12'::date,'male','(512) 555-0141','john.anderson@example.com','Austin','TX','O+','Penicillin','Aetna','AET-449201'),
  ('Maria','Lopez','1990-09-03'::date,'female','(512) 555-0142','maria.lopez@example.com','Austin','TX','A+',null,'Blue Cross','BCX-118833'),
  ('David','Kim','1965-01-22'::date,'male','(512) 555-0143','david.kim@example.com','Round Rock','TX','B+','Sulfa','Medicare','MCR-7781'),
  ('Ashley','Johnson','2015-06-30'::date,'female','(512) 555-0144','ashley.j@example.com','Austin','TX','AB+',null,'UnitedHealthcare','UHC-99012'),
  ('Brian','Smith','1983-11-15'::date,'male','(512) 555-0145','brian.smith@example.com','Cedar Park','TX','O-',null,null,null)
) v
where not exists (select 1 from patients);

insert into appointments (patient_id, doctor_id, scheduled_at, status, token_no, reason, source)
select p.id, d.id, date_trunc('day', now()) + v.t::interval, v.st::appointment_status, v.tok, v.reason, v.src
from (values
  ('john.anderson@example.com','Dr. Sarah Mitchell','10 hours','checked_in',1,'Chest discomfort','web'),
  ('maria.lopez@example.com','Dr. Olivia Patel','11 hours','booked',1,'Annual physical','phone'),
  ('david.kim@example.com','Dr. Michael Brooks','13 hours','booked',1,'Follow-up: migraine','web'),
  ('ashley.j@example.com','Dr. Emily Nguyen','9 hours','completed',1,'Fever and cough','walk_in'),
  ('brian.smith@example.com','Dr. Olivia Patel','11 hours 20 minutes','checked_in',2,'Back pain','walk_in')
) v(email, doc, t, st, tok, reason, src)
join patients p on p.email = v.email
join doctors d on d.full_name = v.doc
where not exists (select 1 from appointments);

insert into leads (name, phone, email, source, interest, status) values
  ('Karen White', '(512) 555-0190', 'karen.w@example.com', 'facebook', 'Heart Health Package', 'new'),
  ('Mark Davis', '(512) 555-0191', 'mark.d@example.com', 'website', 'Knee pain consultation', 'contacted'),
  ('Sophia Turner', '(512) 555-0192', null, 'instagram', 'Dermatology', 'new')
on conflict do nothing;

-- CPT codes for the demo lab tests (used on insurance claims)
update lab_tests t set cpt_code = v.cpt from (values
  ('CBC','85025'),('CMP','80053'),('LIPID','80061'),('HBA1C','83036'),('TSH','84443'),('UA','81003'),
  ('VITD','82306'),('COVID','87635'),('CXR','71046'),('ECG','93000'),('USABD','76700'),('MRIB','70551')
) v(code, cpt) where t.code = v.code and t.cpt_code is null;

update inventory_items set unit_price = v.price from (values
  ('Surgical Gloves (box)', 12.00), ('Syringes 5 mL', 0.40), ('Gauze Pads', 3.50), ('IV Cannula 20G', 2.25)
) v(name, price) where inventory_items.name = v.name and inventory_items.unit_price = 0;


-- =====================================================================
-- 07: Which clinic each patient came to (a clinic = a row in `branches`)
--     + the printable prescription pad.
-- Run after 06_advanced.sql. Safe to run more than once.
-- =====================================================================

-- clinic timings printed on the prescription pad, e.g. "Mon-Sat, 5pm - 9pm"
alter table branches add column if not exists timings text;

-- ---------- Prescription pad design, one per doctor ----------
create table if not exists rx_pad_settings (
  doctor_id uuid primary key references doctors(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,       -- design, colour, paper, font, logo, toggles ...
  updated_at timestamptz not null default now()
);

-- ---------- Visits remember the clinic and the advice written for the patient ----------
alter table visits add column if not exists branch_id uuid references branches(id) on delete set null;
alter table visits add column if not exists advice text;
update visits v set branch_id = a.branch_id from appointments a where v.appointment_id = a.id and v.branch_id is null;
create index if not exists visits_branch_idx on visits(branch_id);

-- a visit is stamped with the clinic of its appointment
create or replace function trg_set_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    if tg_table_name = 'appointments' then
      select branch_id into new.branch_id from doctors where id = new.doctor_id;
    elsif tg_table_name = 'visits' then
      select branch_id into new.branch_id from appointments where id = new.appointment_id;
    elsif tg_table_name = 'admissions' then
      select w.branch_id into new.branch_id from beds b join wards w on w.id = b.ward_id where b.id = new.bed_id;
    elsif tg_table_name = 'pharmacy_sales' then
      select branch_id into new.branch_id from pos_shifts where id = new.shift_id;
    end if;
    new.branch_id := coalesce(new.branch_id, current_branch());
  end if;
  return new;
end $$;

drop trigger if exists set_branch on visits;
create trigger set_branch before insert on visits for each row execute function trg_set_branch();

-- ---------- Row level security ----------
alter table rx_pad_settings enable row level security;
drop policy if exists staff_read on rx_pad_settings;
drop policy if exists own_write on rx_pad_settings;
create policy staff_read on rx_pad_settings for select to authenticated using (is_staff());
create policy own_write on rx_pad_settings for all to authenticated
  using (has_role('{}') or doctor_id in (select id from doctors where profile_id = auth.uid()))
  with check (has_role('{}') or doctor_id in (select id from doctors where profile_id = auth.uid()));

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
