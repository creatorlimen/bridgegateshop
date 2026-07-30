export const permissions = [
  'catalogue.read',
  'catalogue.write',
  'catalogue.publish',
  'pricing.write',
  'inventory.read',
  'inventory.adjust',
  'orders.read',
  'orders.update',
  'payments.record',
  'refunds.approve',
  'customers.read',
  'customers.restrict',
  'quotes.read',
  'quotes.manage',
  'deliveries.read',
  'deliveries.manage',
  'credit.applications.review',
  'credit.limits.manage',
  'credit.repayments.record',
  'credit.adjustments.post',
  'credit.suspend',
  'contractors.moderate',
  'reviews.moderate',
  'content.publish',
  'alerts.preview',
  'alerts.send',
  'settings.public.write',
  'settings.commerce.write',
  'settings.integrations.write',
  'staff.invite',
  'staff.roles.manage',
  'audit.read',
  'reports.export',
] as const;

export type Permission = (typeof permissions)[number];

export function isPermission(value: string): value is Permission {
  return permissions.includes(value as Permission);
}
