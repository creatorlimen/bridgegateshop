import 'server-only';

import type { Timestamp } from 'firebase-admin/firestore';

import type { CheckoutSettings } from '@/lib/config/checkoutSettings';
import type { DeliveryZoneSetting } from '@/lib/config/fulfilmentSettings';
import {
  deliveryDocumentSchema,
  type DeliveryEstimate,
} from '@/lib/schemas/fulfilment';
import type { OrderDocument } from '@/lib/schemas/order';

export function createDeliveryDocument(input: {
  orderId: string;
  order: OrderDocument;
  settings: CheckoutSettings;
  zone: DeliveryZoneSetting | null;
  estimate: DeliveryEstimate;
  now: Timestamp;
}) {
  const actorId = input.order.ownerUid ?? 'system:guest-checkout';
  return deliveryDocumentSchema.parse({
    schemaVersion: 1,
    orderId: input.orderId,
    orderReference: input.order.reference,
    ownerUid: input.order.ownerUid,
    guestAccessTokenHash: input.order.guestAccessTokenHash,
    method: input.order.fulfilment.method,
    status: 'unfulfilled',
    configurationVersion: input.settings.fulfilmentConfigurationVersion,
    zoneSnapshot:
      input.order.fulfilment.method === 'delivery' && input.zone
        ? {
            zoneId: input.zone.id,
            name: input.zone.name,
            feeKobo: input.zone.feeKobo,
            serviceDays: [...input.zone.serviceDays],
            sameDayEnabled: input.zone.sameDayEnabled,
            cutoffLocalTime: input.zone.cutoffLocalTime,
            minimumBusinessDays: input.zone.minimumBusinessDays,
            maximumBusinessDays: input.zone.maximumBusinessDays,
          }
        : null,
    pickupSnapshot:
      input.order.fulfilment.method === 'pickup'
        ? {
            label: input.settings.pickup.label,
            address: input.settings.pickup.address,
            openingHours: input.settings.pickup.openingHours,
            serviceDays: [...input.settings.pickup.serviceDays],
            cutoffLocalTime: input.settings.pickup.cutoffLocalTime,
            minimumPreparationBusinessDays:
              input.settings.pickup.minimumPreparationBusinessDays,
            maximumPreparationBusinessDays:
              input.settings.pickup.maximumPreparationBusinessDays,
          }
        : null,
    estimate: input.estimate,
    assignedStaffUid: null,
    courierName: null,
    trackingReference: null,
    dispatchedAt: null,
    outForDeliveryAt: null,
    fulfilledAt: null,
    exceptionFlags: [],
    latestCustomerEventAt: null,
    createdAt: input.now,
    createdBy: actorId,
    updatedAt: input.now,
    updatedBy: actorId,
    version: 1,
  });
}
