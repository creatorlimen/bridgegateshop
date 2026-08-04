'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { createDeliveryExceptionService } from '@/lib/services/fulfilment/DeliveryExceptionService';
import { createDeliveryTransitionService } from '@/lib/services/fulfilment/DeliveryTransitionService';

function required(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function optional(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(formData: FormData, name: string) {
  const value = Number(required(formData, name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} is invalid.`);
  return value;
}

function actor(context: Awaited<ReturnType<typeof requireStaffPermission>>) {
  return {
    actorId: context.session.uid,
    roleIds: context.membership.roleIds,
    requestId: randomUUID(),
  };
}

function finish(deliveryId: string, notice: string): never {
  revalidatePath('/admin/delivery');
  revalidatePath(`/admin/delivery/${deliveryId}`);
  redirect(`/admin/delivery/${deliveryId}?notice=${encodeURIComponent(notice)}`);
}

function transitionInput(formData: FormData) {
  return {
    deliveryId: required(formData, 'deliveryId'),
    nextStatus: required(formData, 'nextStatus') as
      | 'unfulfilled'
      | 'preparing'
      | 'readyForPickup'
      | 'dispatched'
      | 'outForDelivery'
      | 'delivered'
      | 'collected',
    expectedDeliveryVersion: positiveInteger(formData, 'deliveryVersion'),
    expectedOrderVersion: positiveInteger(formData, 'orderVersion'),
    customerNote: optional(formData, 'customerNote'),
    internalNote: optional(formData, 'internalNote'),
    courierName: optional(formData, 'courierName'),
    trackingReference: optional(formData, 'trackingReference'),
    idempotencyKey: required(formData, 'idempotencyKey'),
  };
}

export async function transitionDeliveryAction(formData: FormData) {
  const context = await requireStaffPermission('deliveries.manage');
  const input = transitionInput(formData);
  await createDeliveryTransitionService().transition(input, actor(context));
  finish(input.deliveryId, 'Fulfilment status updated.');
}

export async function revertDeliveryAction(formData: FormData) {
  const context = await requireStaffPermission('deliveries.manage');
  const input = transitionInput(formData);
  await createDeliveryTransitionService().revert(
    { ...input, reason: required(formData, 'reason') },
    actor(context),
  );
  finish(input.deliveryId, 'Fulfilment status reverted and flagged for review.');
}

export async function reportDeliveryExceptionAction(formData: FormData) {
  const context = await requireStaffPermission('deliveries.manage');
  const deliveryId = required(formData, 'deliveryId');
  await createDeliveryExceptionService().report(
    {
      deliveryId,
      type: required(formData, 'type') as 'overdueEstimate' | 'invalidAddress',
      reason: required(formData, 'reason'),
      sourceEventId: null,
      expectedDeliveryVersion: positiveInteger(formData, 'deliveryVersion'),
      idempotencyKey: required(formData, 'idempotencyKey'),
    },
    actor(context),
  );
  finish(deliveryId, 'Delivery exception opened.');
}

export async function resolveDeliveryExceptionAction(formData: FormData) {
  const context = await requireStaffPermission('deliveries.manage');
  const deliveryId = required(formData, 'deliveryId');
  await createDeliveryExceptionService().resolve(
    {
      exceptionId: required(formData, 'exceptionId'),
      expectedExceptionVersion: positiveInteger(formData, 'exceptionVersion'),
      resolutionNote: required(formData, 'resolutionNote'),
      idempotencyKey: required(formData, 'idempotencyKey'),
    },
    actor(context),
  );
  finish(deliveryId, 'Delivery exception resolved.');
}
