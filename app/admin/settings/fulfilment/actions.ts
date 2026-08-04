'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { createFulfilmentSettingsService } from '@/lib/services/settings/FulfilmentSettingsService';
import { parseNonnegativeNairaToKobo } from '@/lib/utils/money/parseNonnegativeNairaToKobo';

function required(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optional(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(formData: FormData, name: string, minimum = 0) {
  const value = Number(required(formData, name));
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} is invalid.`);
  return value;
}

function list(formData: FormData, name: string) {
  return (optional(formData, name) ?? '').split(/[\r\n,]+/).map((value) => value.trim()).filter(Boolean);
}

function serviceDays(formData: FormData, name: string) {
  return list(formData, name).map(Number);
}

function actor(context: Awaited<ReturnType<typeof requireStaffPermission>>) {
  return { actorId: context.session.uid, roleIds: context.membership.roleIds, requestId: randomUUID() };
}

function finish(notice: string): never {
  revalidatePath('/admin/settings/fulfilment');
  revalidatePath('/delivery');
  revalidatePath('/checkout');
  redirect(`/admin/settings/fulfilment?notice=${encodeURIComponent(notice)}`);
}

export async function updateFulfilmentSettingsAction(formData: FormData) {
  const context = await requireStaffPermission('settings.commerce.write');
  await createFulfilmentSettingsService().saveGlobal(
    {
      expectedVersion: integer(formData, 'expectedVersion'),
      pickup: {
        enabled: formData.get('pickupEnabled') === 'on',
        label: required(formData, 'pickupLabel'),
        address: required(formData, 'pickupAddress'),
        openingHours: required(formData, 'pickupOpeningHours'),
        serviceDays: serviceDays(formData, 'pickupServiceDays'),
        cutoffLocalTime: required(formData, 'pickupCutoff'),
        sameDayEnabled: formData.get('pickupSameDayEnabled') === 'on',
        minimumPreparationBusinessDays: integer(formData, 'pickupMinimumDays'),
        maximumPreparationBusinessDays: integer(formData, 'pickupMaximumDays'),
      },
      supportWhatsappPhone: optional(formData, 'supportWhatsappPhone'),
      trackingRateLimit: {
        windowMinutes: integer(formData, 'trackingWindowMinutes', 1),
        maximumAttemptsPerIp: integer(formData, 'trackingMaximumPerIp', 1),
        maximumAttemptsPerReference: integer(formData, 'trackingMaximumPerReference', 1),
        maximumAttemptsPerFactor: integer(formData, 'trackingMaximumPerFactor', 1),
      },
    },
    actor(context),
  );
  finish('Fulfilment settings updated.');
}

export async function updateDeliveryZoneAction(formData: FormData) {
  const context = await requireStaffPermission('settings.commerce.write');
  await createFulfilmentSettingsService().saveZone(
    {
      zoneId: required(formData, 'zoneId'),
      expectedVersion: integer(formData, 'expectedVersion'),
      expectedSettingsVersion: integer(formData, 'expectedSettingsVersion'),
      name: required(formData, 'name'),
      active: formData.get('active') === 'on',
      areaHints: list(formData, 'areaHints'),
      postcodeHints: list(formData, 'postcodeHints'),
      feeKobo: parseNonnegativeNairaToKobo(required(formData, 'feeNaira')),
      serviceDays: serviceDays(formData, 'serviceDays'),
      sameDayEnabled: formData.get('sameDayEnabled') === 'on',
      cutoffLocalTime: required(formData, 'cutoffLocalTime'),
      minimumBusinessDays: integer(formData, 'minimumBusinessDays'),
      maximumBusinessDays: integer(formData, 'maximumBusinessDays'),
      podEligible: formData.get('podEligible') === 'on',
      deliveryEnabled: formData.get('deliveryEnabled') === 'on',
      displayCopy: required(formData, 'displayCopy'),
      priority: integer(formData, 'priority'),
    },
    actor(context),
  );
  finish('Delivery zone updated and configuration version advanced.');
}

export async function updateBusinessCalendarAction(formData: FormData) {
  const context = await requireStaffPermission('settings.commerce.write');
  await createFulfilmentSettingsService().saveCalendarDate(
    {
      date: required(formData, 'date'),
      name: required(formData, 'name'),
      open: formData.get('open') === 'on',
      affectedZoneIds: formData.getAll('affectedZoneIds').map(String),
      note: optional(formData, 'note'),
      expectedVersion: integer(formData, 'expectedVersion'),
      expectedSettingsVersion: integer(formData, 'expectedSettingsVersion'),
    },
    actor(context),
  );
  finish('Business-calendar date updated and configuration version advanced.');
}
