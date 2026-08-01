'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { loadCheckoutSettings } from '@/lib/config/checkoutSettings';
import { createOrderCancellationService } from '@/lib/services/orders/OrderCancellationService';
import { createAlternativePaymentService } from '@/lib/services/payments/AlternativePaymentService';
import { createRefundService } from '@/lib/services/payments/RefundService';
import { createReturnStockService } from '@/lib/services/payments/ReturnStockService';
import { parseNairaToKobo } from '@/lib/utils/money/parseNairaToKobo';

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optionalText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integerValue(formData: FormData, name: string) {
  const value = Number(textValue(formData, name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} is invalid.`);
  return value;
}

function actorFrom(context: Awaited<ReturnType<typeof requireStaffPermission>>) {
  return {
    actorId: context.session.uid,
    roleIds: context.membership.roleIds,
    requestId: randomUUID(),
  };
}

function finish(orderId: string, message: string): never {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  redirect(`/admin/orders/${orderId}?notice=${encodeURIComponent(message)}`);
}

export async function approvePodOrderAction(formData: FormData) {
  const context = await requireStaffPermission('orders.update');
  const orderId = textValue(formData, 'orderId');
  const settings = await loadCheckoutSettings();
  await createAlternativePaymentService(undefined, settings).approvePodOrder(
    {
      orderId,
      expectedOrderVersion: integerValue(formData, 'orderVersion'),
      idempotencyKey: textValue(formData, 'idempotencyKey'),
    },
    actorFrom(context),
  );
  finish(orderId, 'Pay on Delivery order approved.');
}

async function recordOfflinePayment(
  formData: FormData,
  method: 'manualTransfer' | 'pod',
) {
  const context = await requireStaffPermission('payments.record');
  const orderId = textValue(formData, 'orderId');
  const settings = await loadCheckoutSettings();
  const input = {
    orderId,
    amountKobo: parseNairaToKobo(textValue(formData, 'amountNaira')),
    externalReference: textValue(formData, 'externalReference'),
    transactionDate: new Date(textValue(formData, 'transactionDate')),
    note: optionalText(formData, 'note'),
    evidenceId: optionalText(formData, 'evidenceId'),
    expectedOrderVersion: integerValue(formData, 'orderVersion'),
    idempotencyKey: textValue(formData, 'idempotencyKey'),
  };
  const service = createAlternativePaymentService(undefined, settings);
  if (method === 'manualTransfer') {
    await service.recordManualTransfer(input, actorFrom(context));
  } else {
    await service.recordPodCollection(input, actorFrom(context));
  }
  finish(orderId, 'Payment recorded and reconciled.');
}

export async function recordManualTransferAction(formData: FormData) {
  return recordOfflinePayment(formData, 'manualTransfer');
}

export async function recordPodCollectionAction(formData: FormData) {
  return recordOfflinePayment(formData, 'pod');
}

export async function cancelOrderAction(formData: FormData) {
  const context = await requireStaffPermission('orders.update');
  const orderId = textValue(formData, 'orderId');
  await createOrderCancellationService().cancelOrder(
    {
      orderId,
      reason: textValue(formData, 'reason'),
      expectedOrderVersion: integerValue(formData, 'orderVersion'),
      idempotencyKey: textValue(formData, 'idempotencyKey'),
    },
    actorFrom(context),
  );
  finish(orderId, 'Order cancelled through the controlled workflow.');
}

export async function reviewRefundAction(formData: FormData) {
  const context = await requireStaffPermission('refunds.approve');
  const orderId = textValue(formData, 'orderId');
  const settings = await loadCheckoutSettings();
  await createRefundService(undefined, undefined, settings).reviewRefund(
    {
      refundId: textValue(formData, 'refundId'),
      decision: textValue(formData, 'decision') as 'approved' | 'rejected',
      expectedOrderVersion: integerValue(formData, 'orderVersion'),
      resolutionNote: textValue(formData, 'resolutionNote'),
      idempotencyKey: textValue(formData, 'idempotencyKey'),
    },
    actorFrom(context),
  );
  finish(orderId, 'Refund review recorded.');
}

export async function processRefundAction(formData: FormData) {
  const context = await requireStaffPermission('refunds.approve');
  const orderId = textValue(formData, 'orderId');
  const settings = await loadCheckoutSettings();
  await createRefundService(undefined, undefined, settings).processApprovedRefund(
    textValue(formData, 'refundId'),
    actorFrom(context),
  );
  finish(orderId, 'Refund moved to processing.');
}

export async function recordRefundOutcomeAction(formData: FormData) {
  const context = await requireStaffPermission('refunds.approve');
  const orderId = textValue(formData, 'orderId');
  const settings = await loadCheckoutSettings();
  await createRefundService(undefined, undefined, settings).recordRefundOutcome(
    {
      refundId: textValue(formData, 'refundId'),
      outcome: textValue(formData, 'outcome') as 'processed' | 'failed',
      providerRefundId: textValue(formData, 'providerRefundId'),
      resolutionNote: textValue(formData, 'resolutionNote'),
      idempotencyKey: textValue(formData, 'idempotencyKey'),
    },
    actorFrom(context),
  );
  finish(orderId, 'Refund outcome reconciled.');
}

export async function acceptReturnedStockAction(formData: FormData) {
  const context = await requireStaffPermission('inventory.adjust');
  await requireStaffPermission('refunds.approve');
  const orderId = textValue(formData, 'orderId');
  await createReturnStockService().acceptFullReturn(
    textValue(formData, 'refundId'),
    textValue(formData, 'reason'),
    actorFrom(context),
  );
  revalidatePath('/admin/inventory');
  revalidatePath('/shop');
  finish(orderId, 'Accepted physical return restored to sellable stock.');
}
