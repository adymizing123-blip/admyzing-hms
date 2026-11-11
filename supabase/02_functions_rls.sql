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
