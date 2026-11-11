-- Automated database tests. Run after 00_stub_auth.sql and setup.sql on an empty database:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/00_stub_auth.sql -f supabase/setup.sql -f supabase/tests/10_tests.sql
-- Every check raises an error on failure, so the run stops at the first broken rule.
\set ON_ERROR_STOP 1
grant usage on schema public, auth to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected error like "%" but statement succeeded: %', p_like, p_sql;
exception when others then
  if sqlerrm like 'TEST FAILED%' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then raise exception 'TEST FAILED: expected "%" got "%"', p_like, sqlerrm; end if;
end $$;
create or replace function pg_temp.act_as(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'aal', p_aal)::text, false);
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.com', '{"full_name":"Test Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'pharm@test.com', '{"full_name":"Test Pharmacist"}'),
  ('00000000-0000-0000-0000-00000000000c', 'john.anderson@example.com', '{"full_name":"John Anderson"}'),
  ('00000000-0000-0000-0000-00000000000d', 'nurse@test.com', '{"full_name":"Test Nurse"}');
update profiles set role = 'admin' where email = 'admin@test.com';
update profiles set role = 'pharmacist' where email = 'pharm@test.com';
update profiles set role = 'nurse' where email = 'nurse@test.com';

do $$ begin
  assert (select profile_id from patients where email = 'john.anderson@example.com') is not null, 'signup links existing patient record';
  assert not exists (select 1 from patients where email = 'pharm@test.com'), 'promoting to staff removes empty patient record';
end $$;

set role authenticated;

-- ---------- RLS: patients see only their own data ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$ begin
  assert (select count(*) from patients) = 1, 'patient sees only own patient row';
  assert (select count(*) from appointments) = 1, 'patient sees only own appointments';
  assert (select count(*) from staff) = 0, 'patient cannot read staff';
end $$;

-- ---------- Booking ----------
reset role; set role anon; select pg_temp.act_as(null);
select pg_temp.expect_error($$select book_appointment((select id from doctors limit 1), now() - interval '1 day', 'A','B','1','a@b.com')$$, 'future');
do $$ begin
  assert (book_appointment((select id from doctors where full_name = 'Dr. Olivia Patel'), date_trunc('day', now()) + interval '30 days 15 hours', 'New','Patient','(512) 555-0000','new@test.com', null, null, 'video')->>'video_url') like 'https://meet.jit.si/%', 'video visit gets a link';
end $$;
select pg_temp.expect_error($$select book_appointment((select id from doctors where full_name = 'Dr. Olivia Patel'), date_trunc('day', now()) + interval '30 days 15 hours', 'X','Y','2','x@y.com')$$, 'just booked');
reset role; set role authenticated;

-- ---------- Doctor leave ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into doctor_leaves (doctor_id, start_date, end_date) select id, current_date + 40, current_date + 41 from doctors where full_name = 'Dr. Olivia Patel';
select pg_temp.expect_error($$insert into appointments (patient_id, doctor_id, scheduled_at) select (select id from patients limit 1), id, ((current_date + 40) + time '12:00') at time zone 'America/Chicago' from doctors where full_name = 'Dr. Olivia Patel'$$, 'on leave');

-- ---------- MFA enforcement ----------
update settings set value = value || '{"require_staff_mfa": true}' where key = 'security';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d', 'aal1');
do $$ begin assert (select count(*) from staff) = 0, 'staff without MFA lose access when MFA is required'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d', 'aal2');
do $$ begin assert (select count(*) from staff) > 0, 'staff with MFA keep access'; end $$;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a', 'aal2');
update settings set value = value || '{"require_staff_mfa": false}' where key = 'security';

-- ---------- Pharmacy POS ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select pos_checkout('[{"medicine_id":"00000000-0000-0000-0000-000000000000","quantity":1}]', '[{"method":"cash","amount":1}]')$$, 'open a shift');
select pos_open_shift(100);
do $$
declare r json; tyl uuid := (select id from medicines where sku = 'MED-001');
begin
  r := pos_checkout(jsonb_build_array(jsonb_build_object('medicine_id', tyl, 'quantity', 10)), '[{"method":"card","amount":1},{"method":"cash","amount":5}]'::jsonb, null, 0, 8.25);
  assert (r->>'total')::numeric = 2.71, 'POS total with tax';
  assert (r->>'change')::numeric = 3.29, 'POS change';
  assert (select sum(amount) from pharmacy_sale_payments where sale_id = (r->>'sale_id')::uuid) = 2.71, 'payments recorded net of change';
end $$;
select pg_temp.expect_error($$select pos_checkout(jsonb_build_array(jsonb_build_object('medicine_id',(select id from medicines where sku='MED-003'),'quantity',1)), '[{"method":"cash","amount":5}]')$$, 'needs a prescription');
select pg_temp.expect_error($$select pos_checkout(jsonb_build_array(jsonb_build_object('medicine_id',(select id from medicines where sku='MED-001'),'quantity',1)), '[{"method":"card","amount":5}]')$$, 'over-tendered');
do $$
declare r json; s uuid;
begin
  s := (select id from pharmacy_sales order by created_at limit 1);
  r := pos_refund(s, jsonb_build_array(jsonb_build_object('sale_item_id', (select id from pharmacy_sale_items where sale_id = s), 'quantity', 4)), 'cash');
  assert (r->>'total')::numeric > 0, 'partial refund';
  perform pg_temp.expect_error(format($q$select pos_refund(%L, jsonb_build_array(jsonb_build_object('sale_item_id', %L, 'quantity', 7)), 'cash')$q$, s, (select id from pharmacy_sale_items where sale_id = s)), 'left to return');
  assert ((pos_close_shift(100))->>'expected_cash')::numeric = 100 + 1.71 - (r->>'total')::numeric, 'shift expected cash';
end $$;

-- ---------- Refill approval counts as a prescription ----------
reset role;
insert into refill_requests (patient_id, medicine_id, medicine_name, status, responded_at)
select (select id from patients where email = 'brian.smith@example.com'), id, name, 'approved', now() from medicines where sku = 'MED-003';
do $$ begin assert patient_has_rx((select id from patients where email = 'brian.smith@example.com'), (select id from medicines where sku = 'MED-003')), 'approved refill satisfies Rx check'; end $$;
set role authenticated;

-- ---------- IPD: reservations, MAR, discharge billing ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select reserve_bed((select id from beds where bed_no = 'PR-01'), (select id from patients where email = 'john.anderson@example.com'), null, current_date, current_date + 2, 'Planned');
select pg_temp.expect_error($$select admit_patient((select id from patients where email = 'maria.lopez@example.com'), null, (select id from beds where bed_no = 'PR-01'), 'x')$$, 'reserved');
select admit_reservation((select id from bed_reservations limit 1));
reset role;
insert into medication_orders (admission_id, medicine_id, medicine_name, units_per_dose, times)
select (select id from admissions where status = 'admitted' limit 1), id, name, 2, '{08:00}' from medicines where sku = 'MED-005';
set role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select mar_record((select id from medication_orders limit 1), date_trunc('day', now()) + interval '8 hours', 'given');
select pg_temp.expect_error($$select mar_record((select id from medication_orders limit 1), date_trunc('day', now()) + interval '8 hours', 'given')$$, 'already been recorded');
select pg_temp.expect_error($$select mar_record((select id from medication_orders limit 1), date_trunc('day', now()) + interval '20 hours', 'held')$$, 'reason');
do $$
declare inv uuid;
begin
  inv := discharge_patient((select id from admissions where status = 'admitted' limit 1), 'Stable');
  assert exists (select 1 from invoice_items where invoice_id = inv and category = 'room'), 'room charges billed';
  assert exists (select 1 from invoice_items where invoice_id = inv and description like 'Ward medication%' and quantity = 2), 'ward medication billed';
end $$;

-- ---------- Billing totals ----------
-- nurses cannot take payments
select pg_temp.expect_error($$insert into payments (invoice_id, amount) select id, 1 from invoices limit 1$$, 'row-level security');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$
declare inv uuid;
begin
  insert into invoices (patient_id) values ((select id from patients limit 1)) returning id into inv;
  insert into invoice_items (invoice_id, description, quantity, unit_price) values (inv, 'A', 2, 50);
  insert into payments (invoice_id, amount) values (inv, 40);
  assert (select status from invoices where id = inv) = 'partial', 'partial payment status';
  insert into payments (invoice_id, amount) values (inv, 60);
  assert (select status from invoices where id = inv) = 'paid', 'paid status';
end $$;

-- ---------- Blood bank ----------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$
declare req uuid;
begin
  assert blood_compatible('O-', 'AB+', 'Packed red cells'), 'O- donor universal for red cells';
  assert not blood_compatible('A+', 'O+', 'Packed red cells'), 'A+ red cells not for O+';
  assert not blood_compatible('O+', 'A-', 'Packed red cells'), 'Rh+ not for Rh- recipient';
  insert into blood_requests (patient_id, blood_group, units_needed) values ((select id from patients limit 1), 'O+', 1) returning id into req;
  perform pg_temp.expect_error(format('select blood_issue(%L, array[(select id from blood_units where blood_group = %L and component = %L and status = %L limit 1)])', req, 'A+', 'Packed red cells', 'available'), 'not compatible');
  perform blood_issue(req, array[(select id from blood_units where blood_group in ('O+','O-') and component = 'Packed red cells' and status = 'available' and expires_on >= current_date limit 1)]);
  assert (select status from blood_requests where id = req) = 'issued', 'blood request issued';
end $$;

-- ---------- Ambulance ----------
reset role; set role anon; select pg_temp.act_as(null);
select request_transport('Jane Doe', '(512) 555-1212', '10 Main St', 'CarePlus', now() + interval '1 day', null);
reset role; set role authenticated; select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$
declare t uuid := (select id from ambulance_trips limit 1); a uuid := (select id from ambulances where vehicle_no = 'AMB-01');
begin
  perform trip_set_status(t, 'dispatched', a);
  assert (select status from ambulances where id = a) = 'on_trip', 'ambulance busy after dispatch';
  perform trip_set_status(t, 'completed');
  assert (select status from ambulances where id = a) = 'available', 'ambulance free after trip';
end $$;

-- ---------- Immunizations ----------
do $$ begin
  insert into immunizations (patient_id, vaccine_id, dose_number, given_on) values ((select id from patients limit 1), (select id from vaccines where name = 'Hepatitis B'), 1, current_date);
  assert (select next_due_on from immunizations limit 1) = current_date + 30, 'next dose due date';
end $$;

\echo ALL DATABASE TESTS PASSED
