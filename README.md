# CarePlus Hospital Management System

A complete, mobile-responsive hospital platform: public website with online store, patient portal, CRM, pharmacy POS and a full hospital admin (OPD, IPD, lab, billing, HR and more).

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (PostgreSQL, Auth, Storage, Realtime) · Stripe

---

## What's included

### Public website
- Home, Departments, Doctors (filter by department), Lab Tests & prices, Contact form (saves to CRM as a lead)
- **Online booking wizard**: pick doctor, date, live available slots, confirm, get a token number
- **Health store**: categories, search, product pages, cart, checkout with Stripe (or "pay on delivery" if Stripe is not set up)

### Patient portal (`/portal`)
- Upcoming and past appointments (cancel online)
- Visit history with prescriptions
- Lab results (visible once published by the lab)
- Bills and balance due, store orders
- Edit personal and insurance details

### Hospital admin (`/admin`)
| Module | Highlights |
|---|---|
| Dashboard | Today's KPIs, 30-day revenue chart, revenue by source, alerts (low stock, expiring batches, pending labs, new leads) |
| Patients / EMR | Registration with MRN, allergies, insurance, full record: visits, labs, admissions, bills, document uploads |
| Appointments | Day view, filters, check-in, no-show, cancel, phone/walk-in booking, video visits, doctor leave banner |
| OPD Queue | Live Kanban board (Booked, Waiting, With doctor, Done), realtime updates, walk-in tokens |
| Consultation | Vitals, complaints, diagnosis with ICD-10 codes, e-prescription, order lab tests, follow-up, start video call, auto consultation bill (CPT 99213), printable prescription |
| IPD & Beds | Visual bed board by ward, admit, advance bed reservations, transfer, nursing notes, Medication Administration Record (MAR), discharge summary, automatic room + ward medication charges |
| Operation Theatre | Scheduling, pre-op checklist, anesthesia record, operative and post-op notes, blood loss, complications, consumables (deducted from stock), procedure billing with CPT code, printable OT record |
| Laboratory | Orders, sample tracking, result entry with flags, publish to portal, printable report, bill the order |
| Pharmacy POS | Barcode scan or search, cart, discount, sales tax, split payments (cash with change, card, insurance, patient bill), Stripe Terminal card reader, prescription check, returns and refunds, shifts with cash drawer (open, cash in/out, close with X/Z report), FEFO stock deduction (first-expiry, first-out), printable receipts |
| Medicines & Stock | Catalog, batches with expiry, expiring-soon list, suppliers, purchase orders (receive into stock), sales history, returns, shift reports |
| Online Store | Website orders with status workflow, product catalog management |
| Inventory | Consumables, surgical items, equipment, linen; stock in and issue to departments |
| Billing | Invoices with CPT codes, partial payments, discount/tax, insurance claims with CMS-1500 style form, JSON export and electronic submission via your clearinghouse, void, printable invoice, expenses |
| CRM | Leads (convert to patient), send SMS/WhatsApp/email, follow-ups (send with one click), campaigns sent to patients or leads, message log, feedback |
| HR & Payroll | Staff directory, daily attendance (check in/out), duty roster, monthly payroll (salary, hourly, doctor commission) |
| Reports | Revenue, expenses, net, payment methods, service mix, top medicines, visits per doctor, CSV export |
| Settings | Users and roles, create staff logins, hospital details (NPI, Tax ID, timezone), departments, doctors, doctor leave calendar, wards, beds, audit log |

### Security
- **Row Level Security** on every table. Each role can only write to its own modules; patients can only see their own records.
- **Audit log** of every change to patients, visits, prescriptions, admissions, invoices, payments, stock, staff and payroll.
- Store prices are always re-read on the server during checkout.

---

## Roles

| Role | Access |
|---|---|
| Admin | Everything, including Settings and audit log |
| Doctor | Patients, appointments, OPD and consultations, IPD, OT, lab orders |
| Nurse | Patients, OPD, IPD and nursing notes, OT, inventory |
| Receptionist | Patients, appointments, OPD, IPD admissions, billing, CRM, POS, store orders |
| Pharmacist | Pharmacy POS, medicines and stock, online store, inventory |
| Lab Tech | Laboratory |
| Accountant | Billing, payments, claims, expenses, HR and payroll, reports |
| Patient | Patient portal only |

---

## Setup (about 10 minutes)

### 1. Create the database
1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/setup.sql` and click **Run**.
   - This creates all tables, security rules, business logic and storage buckets, and loads demo data.
   - For a clean install without demo data, run `01_schema.sql`, `02_functions_rls.sql`, then `04_pos_upgrade.sql` to `08_chats_automations.sql` in order.
   - **Already ran an older setup.sql?** Run only the upgrade files you have not run yet, in order: `04_pos_upgrade.sql` (POS), `05_hospital_upgrade.sql` (hospital features), `06_advanced.sql` (ER, blood bank, branches, security and more), `07_doctor_clinics.sql` (doctors at many clinics, clinic check-in, prescription pad), `08_chats_automations.sql` (lead sources, WhatsApp/Facebook/Instagram chats, automations).
   - Then (optional, recommended) edit and run `09_automation_scheduler.sql` so automations run every 5 minutes.
3. In **Authentication > Providers > Email**, you can turn off "Confirm email" while testing.

### 2. Configure the app
```bash
cp .env.example .env.local
```
Fill in from **Supabase > Project Settings > API**:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 3. Run it
```bash
npm install
npm run dev
```
Open http://localhost:3000

### 4. Create the first admin
1. Go to `/login` and create an account.
2. In Supabase SQL Editor run:
   ```sql
   update profiles set role = 'admin' where email = 'you@yourhospital.com';
   ```
3. Sign in again: you will land on `/admin`.
4. From **Settings > Users & roles > Create staff login** you can now create accounts for doctors, nurses, pharmacists and others, and link each doctor login to their doctor profile (so their OPD queue opens automatically).

### 5. Stripe (optional)
1. Add `STRIPE_SECRET_KEY` to `.env.local`.
2. Create a webhook in Stripe pointing to `https://YOUR-DOMAIN/api/stripe/webhook` for the event `checkout.session.completed`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Paid orders are marked **Paid** automatically and product stock is reduced.

Without Stripe keys, store checkout still works and orders are saved as "pay on delivery".

### 6. Card reader for the pharmacy POS (optional)
1. In Stripe Dashboard > **Terminal**, create a location and register a reader (for example a BBPOS WisePOS E or Stripe Reader S700). In test mode you can create a **simulated** reader.
2. Put the reader id (`tmr_...`) in `STRIPE_TERMINAL_READER_ID`.
3. In the POS, choose **Card** and press **Send to reader**. The sale completes once the card is approved. Refunds of those sales go back to the same card automatically.

Without a reader, card payments are still recorded (with the last 4 digits) and refunded manually on your own card machine.

### 7. SMS, WhatsApp and email (optional)
- **SMS / WhatsApp:** create a [Twilio](https://www.twilio.com) account, buy a US number (register it for A2P 10DLC so carriers deliver your texts) and fill `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. For WhatsApp, use the Twilio sandbox number for testing or your approved WhatsApp sender in `TWILIO_WHATSAPP_FROM`.
- **Email:** create a [Resend](https://resend.com) account, verify your domain and fill `RESEND_API_KEY` and `EMAIL_FROM`.
- **Automatic reminders:** set `CRON_SECRET`. Reminders and follow-ups are now rules in **Admin > Automations** (see below), sent by `/api/cron/automations`.
- Without these keys everything still works; messages are logged as "skipped" in CRM > Message log.

### 8. Insurance claims (optional)
1. Add your **NPI** and **Tax ID** in Admin > Settings > Hospital.
2. Doctors enter **ICD-10** codes in the consultation; lab tests and consultations carry **CPT** codes automatically, and you can add codes to any invoice line.
3. From an invoice, create a claim. The claim page shows a CMS-1500 style form you can print, a JSON download, and a checklist of anything missing.
4. **Electronic submission** needs a clearinghouse or billing service (for example Availity, Office Ally, Stedi or your billing company). Put the endpoint they give you (or a Zapier/Make webhook that forwards to them) in `CLAIMS_WEBHOOK_URL`. "Submit electronically" posts the claim JSON there and records the response.

---

## Hospital features added in 05_hospital_upgrade.sql
- **Video visits:** patients choose "Video visit" when booking. A private Jitsi Meet room is created automatically; the patient joins from the portal or the reminder, the doctor from the consultation screen. No app or account needed.
- **Doctor leave:** Settings > Doctor leave. Those days disappear from online booking and the database blocks any booking on them.
- **Advance bed booking:** tap a free bed, choose "Reserve for later". Reserved beds show in violet on the day and can only be given to that patient. Upcoming reservations have "Admit now".
- **MAR:** doctors write medication orders (dose, route, times or PRN). Nurses chart each dose as Given, Held or Refused (a reason is required). Given doses come out of pharmacy stock and are billed automatically at discharge.
- **OT record:** open any surgery to fill pre-op, anesthesia, operative and post-op notes, add consumables (taken from stock) and create the bill.

---

## Modules added in 08_chats_automations.sql

### Where every patient comes from
- Patients and leads have a **source** (Website, Facebook, Instagram, WhatsApp, Google, Phone call, Walk-in, Referral, Other), an optional **ad / campaign name**, and a **clinic**.
- Set automatically: website visitors who arrive with `?utm_source=instagram&utm_campaign=laser-nov` (or a Facebook / Google ad click) keep that source on the contact form and online booking; chats get the channel as their source and the clinic of the number or page they wrote to; click-to-WhatsApp and Messenger ads save the ad headline.
- When someone who first came as a lead is registered as a patient (same phone or email), the patient keeps the lead's source, ad and clinic, the lead is marked converted and their chats are linked. CRM **Convert** does the same.
- **Dashboard → Leads, patients and chats** (7 / 30 / 90 days, all clinics): leads by source with conversion, new patients by source, chats by channel, and a table of visits, new patients, leads and chats per clinic. Patients and CRM have source and clinic filters.

### Chats: WhatsApp, Facebook and Instagram in one inbox (`/admin/chats`)
- Every message from the clinics' WhatsApp numbers, Facebook pages and Instagram accounts arrives in one live inbox, tagged with channel and clinic. Filter by channel, clinic, open/closed and unread; reply from the dashboard and it goes out from the same number or page.
- New people become **leads** automatically (source = the channel); known patients are matched by phone. Buttons: Add as lead, Make patient, Book appointment, Close/Reopen, change clinic.
- Replies typed in the WhatsApp Business app on the phone (coexistence) and in the Meta inbox also appear, so the thread is complete.
- WhatsApp rules are shown in the composer: free text within 24 hours of the person's last message, an approved template after that. Facebook/Instagram replies after 24 hours are sent with the Human Agent tag (up to 7 days).
- Every WhatsApp the system sends (reminders, prescriptions, campaigns, automations) is saved in the same thread.

**Connect Meta (WhatsApp Cloud API, Messenger, Instagram):**
1. In [developers.facebook.com](https://developers.facebook.com) create a Business app, add the **WhatsApp**, **Messenger** and **Instagram** products, and connect your WhatsApp Business Account, Facebook pages and Instagram accounts.
2. In Business Settings create a **System user**, give it your WhatsApp account, pages and Instagram accounts, and generate a token with `whatsapp_business_messaging`, `whatsapp_business_management`, `pages_messaging`, `pages_manage_metadata`, `instagram_manage_messages`. Put it in `META_ACCESS_TOKEN`, the app secret in `META_APP_SECRET`, and any string you choose in `META_VERIFY_TOKEN`.
3. Webhooks: callback URL `https://YOUR-DOMAIN/api/webhooks/meta` with your verify token. Subscribe **WhatsApp Business Account** to `messages` (and `smb_message_echoes` if you use the WhatsApp Business app on the phone too), **Page** to `messages`, `messaging_postbacks`, `message_echoes`, and **Instagram** to `messages`.
4. In **Chats → Channels**, add each WhatsApp number (its *phone number ID*), Facebook page (*Page ID*) and Instagram account (*Instagram account ID* plus its linked Page ID) and choose its clinic.
5. Instead of Meta you can use **Twilio** for WhatsApp/SMS: set the number's "A message comes in" webhook to `https://YOUR-DOMAIN/api/webhooks/twilio` and add the number under Channels with provider Twilio.

### Automations (`/admin/automations`)
Rules that send themselves, each with an on/off switch, editable message with `{variables}`, live preview, **Send test**, timing (minutes / hours / days before or after), channel, clinic and source conditions:

| Area | Built-in rules (on by default in bold) |
|---|---|
| Appointments | **Booking confirmation**, **Reminder 1 day before**, Reminder 2 hours before, Send prescription after visit, Thank you + Google review request, **Missed appointment (no-show) rebooking**, Cancelled appointment rebooking |
| Leads & chats | **New lead welcome** (website/phone), **Chat auto-reply** (first message), After-hours chat reply, **CRM follow-ups** |
| Patient care | **Follow-up visit reminder** (the date the doctor set), **Lab results ready** |
| Billing | Unpaid bill reminder (3 days) |
| Marketing | Birthday wishes, 6-month check-up recall (respect marketing opt-out) |
| Staff alerts | New lead alert to the owner, Lead not contacted in 1 hour, Daily low-stock list |

- "Best available" channel: replies in the chat if the person wrote to you, otherwise WhatsApp, then SMS, then email.
- Every send is logged under **Activity** with the reason when something is skipped (e.g. "Appointment was moved", "Patient opted out") and failed sends retry up to 3 times.
- Reminders follow changes: moving an appointment reschedules its reminder; cancelling or checking in stops it.
- WhatsApp through Meta needs an approved **template** for messages that start a conversation (reminders, birthdays, recalls). Add the template name and its values in the rule's WhatsApp template settings. Chat replies do not need one.
- **Scheduling:** chat replies go out instantly from the webhook and staff bookings send their confirmation right away. Everything else runs from `/api/cron/automations`: run `supabase/09_automation_scheduler.sql` (Supabase pg_cron, every 5 minutes, works on any plan), or use Vercel Cron on a Pro plan. `vercel.json` keeps a daily run as a fallback. **Run now** is on the Setup tab.

## Modules added in 07_doctor_clinics.sql

- **Clinic per patient**: when booking an appointment or registering a walk-in, choose the clinic the patient came to (a clinic is a branch). The dashboard shows **Patients by clinic today**, and **Clinics** (`/admin/clinics`) lists every clinic with the patients who came, by day. Appointments and OPD queue have a clinic filter and show the clinic on each patient.
- **Prescription Pad** (`/admin/rx-pad`): each doctor designs a pad (4 layouts, 6 colours, A4/A5, logo, watermark). During a consultation everything typed (patient, vitals, complaints, diagnosis, medicines, tests, advice, follow-up) appears on the pad live; the clinic name, address, phone and timings on the pad are those of the clinic the patient came to (set timings in Settings → Branches). Print, or Save as PDF from the print dialog. **Send on WhatsApp** sends the prescription text to the patient's phone: with Twilio configured the Send button delivers it; without any keys, "Open in WhatsApp" opens your own WhatsApp with the message ready (attach the saved PDF there if you want the pad itself).

## Modules added in 06_advanced.sql
| Area | What it does |
|---|---|
| Security | Forgot/reset password, staff two-step verification (authenticator app) with an option to require it for all staff (enforced in the database), automatic sign-out after inactivity (default 15 min), "My account" page |
| Multi-branch | Branches in Settings, branch switcher in the sidebar. Appointments, beds, ER, pharmacy stock and POS, invoices, lab, OT, inventory and the dashboard follow the selected branch. Each branch has its own medicine stock. |
| Emergency | Live ER board sorted by ESI triage level (1 to 5), waiting timers, vitals, unknown-patient registration, doctor/bay assignment, disposition (discharge, admit, transfer, left) |
| Blood bank | Stock by group and component, units with expiry, donors, transfusion requests, issuing with ABO/Rh compatibility checks |
| Referrals | Doctor to doctor or to outside specialists, accept/decline, book the visit |
| Immunizations | Vaccine catalog (CVX codes), doses given, next dose due list, shown in the patient record and portal |
| Diet & kitchen | Diet orders per admitted patient, allergy flags, daily meal checklist, printable meal list |
| Ambulance | Fleet status, dispatch board with trip progress, website requests for non-emergency transport, automatic billing on completion |
| Lab interface | HL7 v2 ORU endpoint for analyzers / interface engines (`/api/lab/hl7`), manual HL7/CSV import on a lab order, interface log |
| Imaging | Built-in DICOM viewer for uploaded .dcm files (uncompressed images; window/level, zoom, frames) |
| Patient portal | Pay bills online (Stripe), upload documents, secure messaging with the care team (Patient Inbox for staff), prescription refill requests (approved refills count at the pharmacy), immunization record, marketing opt-out |
| Spanish | Website and patient portal in English or Spanish (toggle in the header). Staff screens stay in English. Database content such as department descriptions and product names stays as entered. |
| Scheduled reports | Daily, weekly or monthly summary emails (Reports > Scheduled emails) |
| Data import | CSV or Excel import for patients, medicines with opening stock, inventory, staff and suppliers, with templates and row-by-row validation |

### Lab analyzer connection
Set `LAB_INTERFACE_TOKEN`. Your interface engine (for example Mirth Connect) or LIS posts HL7 ORU^R01 messages to `https://YOUR-DOMAIN/api/lab/hl7` with the header `Authorization: Bearer <token>`. Results are matched by the order number (OBR-2/3, e.g. `LAB-2001`) and the test code or CPT code in OBX-3. Analyzers usually need a middleware box to speak HTTPS; ask your analyzer vendor.

---

## Testing
- `npm test` runs the unit tests (phone formatting, claims, HL7 parsing, translations).
- `npm run test:db` runs the database tests on an **empty** PostgreSQL database (`DATABASE_URL=...`). They check security rules, booking, POS, refunds, shifts, MAR, billing, blood compatibility, ambulance, chats, lead attribution, automations and more. Never point it at your live project.
- `.github/workflows/ci.yml` runs both plus a full build on every push when the code is on GitHub.

---

## Pharmacy POS: how it works
- **Shifts:** each cashier opens a shift with the cash in the drawer. Sales, refunds and cash in/out are tracked against it. Closing the shift asks for the counted cash and shows over/short, with a printable Z-report. All shifts are listed under Medicines & Stock > Shifts.
- **Split payments:** combine cash, card, insurance and patient bill on one sale. Cash can be over-tendered and the change is shown.
- **Patient bill:** link a patient and choose "Patient bill" to add the amount to their hospital invoice (useful for admitted patients).
- **Prescription check:** Rx medicines need either a prescription on file for the linked patient (last 180 days) or the outside prescription details typed in. This is enforced in the database too.
- **Returns:** find a receipt, choose items and quantities, decide whether each goes back to stock, and refund to cash, card, insurance or the patient bill. Discount and tax are refunded proportionally.

---

## Deploy

**Vercel (recommended):** import the project, add the same environment variables, deploy. Set `NEXT_PUBLIC_SITE_URL` to your live domain.

---

## Project structure
```
supabase/
  setup.sql              all-in-one install (01 + 02 + 03)
  01_schema.sql          tables, enums, sequences
  02_functions_rls.sql   business logic (RPC), triggers, Row Level Security, storage
  03_seed.sql            demo data (US hospital, USD)
src/
  app/(site)/            public website and store
  app/portal/            patient portal
  app/admin/             hospital admin modules
  app/api/               checkout, Stripe webhook, staff user creation
  components/admin/      shared admin components (ResourceManager, PatientPicker, Shell...)
  components/site/       website components (header, cart, cards)
  components/ui/         design system (badges, modals, tabs, stat cards)
  lib/                   Supabase clients, navigation, shared form fields, helpers
```

**Shared components:** most admin screens are built on one `ResourceManager` component (list, search, pagination, add/edit form, mobile cards). Changing its design updates every module at once. Shared form definitions live in `src/lib/fields.ts`, and role-based navigation in `src/lib/nav.ts`.

---

## Customizing
- **Hospital name, phone, address, tax rate:** Admin > Settings > Hospital
- **Brand colors:** `tailwind.config.ts` (the `brand` palette)
- **Store shipping and tax:** `src/lib/store.ts`
- **Departments, doctors, schedules, fees, wards, beds, lab tests:** Admin > Settings and Admin > Laboratory > Test catalog

## Before going live (checklist)
1. **Run it on your real Supabase project** and click through every module once with test data (login, uploads, live OPD/ER updates, payments).
2. **HIPAA:** sign a Business Associate Agreement (BAA) with Supabase (Team plan + HIPAA add-on) and Vercel (Enterprise) or your host, plus Twilio and your email provider if they will carry patient information. This is done in your accounts, not in code.
3. **Video visits:** replace the free Jitsi server with a HIPAA-compliant video service or your own Jitsi server.
4. Turn on **Settings > Security > Require two-step verification** after every admin has set up their authenticator.
5. Turn on **Point-in-time recovery / daily backups** in Supabase.
6. Review roles and access with your compliance officer.
7. **WhatsApp templates:** get your reminder, birthday and recall templates approved in WhatsApp Manager and add them to those automation rules.
8. Schedule automations (`09_automation_scheduler.sql`) and check **Automations > Activity** after the first day.
