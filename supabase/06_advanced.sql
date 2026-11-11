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
