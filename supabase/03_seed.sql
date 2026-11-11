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
