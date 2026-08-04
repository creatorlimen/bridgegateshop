'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { createNotificationSettingsService } from '@/lib/services/settings/NotificationSettingsService';

function required(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
function optional(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function integer(formData: FormData, name: string) {
  const value = Number(required(formData, name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} is invalid.`);
  return value;
}
function actor(context: Awaited<ReturnType<typeof requireStaffPermission>>) {
  return { actorId: context.session.uid, roleIds: context.membership.roleIds, requestId: randomUUID() };
}
function finish(notice: string): never {
  revalidatePath('/admin/settings/notifications');
  redirect(`/admin/settings/notifications?notice=${encodeURIComponent(notice)}`);
}

export async function updateNotificationSettingsAction(formData: FormData) {
  const context = await requireStaffPermission('settings.commerce.write');
  await createNotificationSettingsService().saveSettings({
    expectedVersion: integer(formData, 'expectedVersion'),
    email: {
      enabled: formData.get('emailEnabled') === 'on',
      fromName: required(formData, 'fromName'),
      fromEmail: required(formData, 'fromEmail'),
      replyToEmail: optional(formData, 'replyToEmail'),
      maximumAttempts: integer(formData, 'emailMaximumAttempts'),
    },
    sms: {
      enabled: formData.get('smsEnabled') === 'on',
      senderId: required(formData, 'senderId'),
      enabledStatuses: formData.getAll('smsEnabledStatuses').map(String) as Array<'preparing' | 'readyForPickup' | 'dispatched' | 'outForDelivery' | 'delivered' | 'collected'>,
      maximumAttempts: integer(formData, 'smsMaximumAttempts'),
    },
  }, actor(context));
  finish('Notification channels updated.');
}

export async function updateNotificationTemplateAction(formData: FormData) {
  const context = await requireStaffPermission('settings.commerce.write');
  await createNotificationSettingsService().saveTemplate({
    fulfilmentStatus: required(formData, 'fulfilmentStatus') as 'preparing' | 'readyForPickup' | 'dispatched' | 'outForDelivery' | 'delivered' | 'collected',
    channel: required(formData, 'channel') as 'email' | 'sms',
    subjectTemplate: optional(formData, 'subjectTemplate'),
    bodyTemplate: required(formData, 'bodyTemplate'),
    active: formData.get('active') === 'on',
    providerTemplateId: optional(formData, 'providerTemplateId'),
    expectedVersion: integer(formData, 'expectedVersion'),
  }, actor(context));
  finish('Notification template updated.');
}
