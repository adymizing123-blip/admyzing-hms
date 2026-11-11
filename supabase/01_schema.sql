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
