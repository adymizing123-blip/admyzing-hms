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
