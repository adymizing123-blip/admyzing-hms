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
