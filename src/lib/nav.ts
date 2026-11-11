import type { Role } from './utils';

export type NavItem = { href: string; label: string; icon: string; roles: Role[] | 'all' };
export type NavGroup = { label: string; items: NavItem[] };

const clinical: Role[] = ['doctor', 'nurse', 'receptionist'];

export const NAV: NavGroup[] = [
  { label: 'Overview', items: [
    { href: '/admin', label: 'Dashboard', icon: 'LayoutDashboard', roles: 'all' },
  ] },
  { label: 'Clinical', items: [
    { href: '/admin/patients', label: 'Patients', icon: 'Users', roles: [...clinical, 'lab_tech', 'accountant'] },
    { href: '/admin/appointments', label: 'Appointments', icon: 'CalendarDays', roles: clinical },
    { href: '/admin/emergency', label: 'Emergency', icon: 'Siren', roles: clinical },
    { href: '/admin/opd', label: 'OPD Queue', icon: 'Stethoscope', roles: clinical },
    { href: '/admin/clinics', label: 'Clinics', icon: 'Building2', roles: clinical },
    { href: '/admin/rx-pad', label: 'Prescription Pad', icon: 'FileText', roles: ['doctor'] },
    { href: '/admin/chats', label: 'Chats (WA, FB, Insta)', icon: 'MessagesSquare', roles: ['doctor', 'nurse', 'receptionist'] },
    { href: '/admin/inbox', label: 'Patient Inbox', icon: 'Inbox', roles: ['doctor', 'nurse', 'receptionist'] },
    { href: '/admin/referrals', label: 'Referrals', icon: 'Share2', roles: clinical },
    { href: '/admin/ipd', label: 'IPD & Beds', icon: 'BedDouble', roles: clinical },
    { href: '/admin/ot', label: 'Operation Theatre', icon: 'Scissors', roles: ['doctor', 'nurse'] },
    { href: '/admin/lab', label: 'Laboratory', icon: 'FlaskConical', roles: ['lab_tech', 'doctor', 'receptionist'] },
    { href: '/admin/blood-bank', label: 'Blood Bank', icon: 'Droplets', roles: ['lab_tech', 'doctor', 'nurse'] },
    { href: '/admin/immunizations', label: 'Immunizations', icon: 'Syringe', roles: ['doctor', 'nurse'] },
    { href: '/admin/kitchen', label: 'Diet & Kitchen', icon: 'Utensils', roles: ['nurse', 'receptionist', 'doctor'] },
    { href: '/admin/ambulance', label: 'Ambulance', icon: 'Ambulance', roles: ['receptionist', 'nurse'] },
  ] },
  { label: 'Pharmacy & Store', items: [
    { href: '/admin/pharmacy/pos', label: 'Pharmacy POS', icon: 'ShoppingCart', roles: ['pharmacist', 'receptionist'] },
    { href: '/admin/pharmacy', label: 'Medicines & Stock', icon: 'Pill', roles: ['pharmacist'] },
    { href: '/admin/store', label: 'Online Store', icon: 'Store', roles: ['pharmacist', 'receptionist'] },
    { href: '/admin/inventory', label: 'Inventory', icon: 'Boxes', roles: ['nurse', 'pharmacist'] },
  ] },
  { label: 'Business', items: [
    { href: '/admin/billing', label: 'Billing', icon: 'Receipt', roles: ['accountant', 'receptionist'] },
    { href: '/admin/crm', label: 'CRM', icon: 'Megaphone', roles: ['receptionist'] },
    { href: '/admin/automations', label: 'Automations', icon: 'Workflow', roles: [] },
    { href: '/admin/hr', label: 'HR & Payroll', icon: 'UserCog', roles: ['accountant'] },
    { href: '/admin/reports', label: 'Reports', icon: 'BarChart3', roles: ['accountant'] },
    { href: '/admin/import', label: 'Data Import', icon: 'Upload', roles: [] },
    { href: '/admin/settings', label: 'Settings', icon: 'Settings', roles: [] },
  ] },
];

export function navFor(role: Role) {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => role === 'admin' || i.roles === 'all' || (i.roles as Role[]).includes(role)),
  })).filter((g) => g.items.length);
}
