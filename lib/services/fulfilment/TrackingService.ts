import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { loadFulfilmentSettings } from '@/lib/config/fulfilmentSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { normaliseNigerianPhoneNumber } from '@/lib/schemas/customer';
import {
  deliveryDocumentSchema,
  deliveryEventDocumentSchema,
  type FulfilmentSettingsDocument,
} from '@/lib/schemas/fulfilment';
import { orderDocumentSchema } from '@/lib/schemas/order';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

const trackingLookupInputSchema = z.object({
  reference: z.string().trim().toUpperCase().max(32),
  factor: z.string().trim().max(320),
  ipAddress: z.string().trim().min(1).max(200),
});

const publicReferencePattern = /^BGS-[A-Z0-9]{16}$/;
const emailSchema = z.string().email().max(320);

const customerStatusLabels = {
  unfulfilled: 'Order confirmed',
  preparing: 'Being prepared',
  readyForPickup: 'Ready for pickup',
  dispatched: 'Dispatched',
  outForDelivery: 'Out for delivery',
  delivered: 'Delivered',
  collected: 'Collected',
  cancelled: 'Cancelled',
} as const;

export type TrackingLookupResult = {
  reference: string;
  method: 'delivery' | 'pickup';
  status: keyof typeof customerStatusLabels;
  statusLabel: string;
  estimate: {
    label: string;
    earliestDate: string;
    latestDate: string;
  };
  destinationLabel: string;
  timeline: Array<{
    id: string;
    status: keyof typeof customerStatusLabels;
    label: string;
    note: string | null;
    occurredAt: string;
  }>;
  supportWhatsappUrl: string | null;
};

export class TrackingLookupError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'RATE_LIMITED') {
    super(
      code === 'RATE_LIMITED'
        ? 'Too many tracking attempts. Please wait and try again.'
        : 'We could not verify an order with those details.',
    );
    this.name = 'TrackingLookupError';
  }
}

type OrderAccessProof = {
  ownerUid: string | null;
  guestTokenHash: string | null;
};

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normaliseFactor(value: string) {
  const email = value.toLowerCase();
  if (emailSchema.safeParse(email).success) {
    return { kind: 'email' as const, value: email };
  }
  const phone = normaliseNigerianPhoneNumber(value);
  return phone ? { kind: 'phone' as const, value: phone } : null;
}

class FirestoreTrackingService {
  constructor(private readonly firestore: Firestore) {}

  async lookupWithFactor(unparsedInput: z.input<typeof trackingLookupInputSchema>) {
    const input = trackingLookupInputSchema.parse(unparsedInput);
    const settings = await loadFulfilmentSettings(this.firestore);
    const normalizedFactor = normaliseFactor(input.factor);
    await this.consumeRateLimits(
      input.ipAddress,
      input.reference,
      normalizedFactor?.value ?? input.factor.toLowerCase(),
      settings.trackingRateLimit,
    );
    if (!publicReferencePattern.test(input.reference) || !normalizedFactor) {
      throw new TrackingLookupError('NOT_FOUND');
    }
    const orderSnapshot = await this.firestore
      .collection(firestoreCollections.orders)
      .where('reference', '==', input.reference)
      .limit(2)
      .get();
    if (orderSnapshot.size !== 1) {
      throw new TrackingLookupError('NOT_FOUND');
    }
    const orderParse = orderDocumentSchema.safeParse(orderSnapshot.docs[0].data());
    if (!orderParse.success) throw new TrackingLookupError('NOT_FOUND');
    const order = { id: orderSnapshot.docs[0].id, ...orderParse.data };
    const factorMatches =
      (normalizedFactor.kind === 'email' &&
        safeEquals(normalizedFactor.value, order.customer.email.toLowerCase())) ||
      (normalizedFactor.kind === 'phone' &&
        safeEquals(normalizedFactor.value, order.customer.phone));
    if (!factorMatches) throw new TrackingLookupError('NOT_FOUND');
    return this.getSafeProjection(order.id, settings);
  }

  async lookupForOwner(reference: string, proof: OrderAccessProof) {
    const normalizedReference = reference.trim().toUpperCase();
    if (!publicReferencePattern.test(normalizedReference)) {
      throw new TrackingLookupError('NOT_FOUND');
    }
    const orderSnapshot = await this.firestore
      .collection(firestoreCollections.orders)
      .where('reference', '==', normalizedReference)
      .limit(2)
      .get();
    if (orderSnapshot.size !== 1) throw new TrackingLookupError('NOT_FOUND');
    const orderParse = orderDocumentSchema.safeParse(orderSnapshot.docs[0].data());
    if (!orderParse.success) throw new TrackingLookupError('NOT_FOUND');
    const order = orderParse.data;
    const ownerMatches = proof.ownerUid !== null && order.ownerUid === proof.ownerUid;
    const guestMatches =
      proof.guestTokenHash !== null &&
      order.guestAccessTokenHash !== null &&
      safeEquals(proof.guestTokenHash, order.guestAccessTokenHash);
    if (!ownerMatches && !guestMatches) throw new TrackingLookupError('NOT_FOUND');
    const settings = await loadFulfilmentSettings(this.firestore);
    return this.getSafeProjection(orderSnapshot.docs[0].id, settings);
  }

  private async consumeRateLimits(
    ipAddress: string,
    reference: string,
    factor: string,
    settings: FulfilmentSettingsDocument['trackingRateLimit'],
  ) {
    const now = Timestamp.now();
    const windowMilliseconds = settings.windowMinutes * 60_000;
    const windowStart =
      Math.floor(now.toMillis() / windowMilliseconds) * windowMilliseconds;
    const dimensions = [
      ['ip', ipAddress, settings.maximumAttemptsPerIp],
      ['reference', reference.toUpperCase(), settings.maximumAttemptsPerReference],
      ['factor', factor.toLowerCase(), settings.maximumAttemptsPerFactor],
    ] as const;
    const references = dimensions.map(([dimension, value]) =>
      this.firestore
        .collection(firestoreCollections.rateLimitBuckets)
        .doc(
          createDeterministicId(
            'tracking-rate',
            `${dimension}:${hash(value)}:${windowStart}`,
          ),
        ),
    );
    const allowed = await this.firestore.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(...references);
      if (
        snapshots.some((snapshot, index) => {
          const count = snapshot.exists
            ? Number(snapshot.data()?.attemptCount ?? 0)
            : 0;
          return count >= dimensions[index][2];
        })
      ) {
        return false;
      }
      references.forEach((reference, index) => {
        const existing = snapshots[index];
        const previousCount = existing.exists
          ? Number(existing.data()?.attemptCount ?? 0)
          : 0;
        transaction.set(reference, {
          schemaVersion: 1,
          scope: 'publicTracking',
          dimension: dimensions[index][0],
          valueHash: hash(dimensions[index][1]),
          windowStartedAt: Timestamp.fromMillis(windowStart),
          expiresAt: Timestamp.fromMillis(windowStart + windowMilliseconds * 2),
          attemptCount: previousCount + 1,
          updatedAt: now,
        });
      });
      return true;
    });
    if (!allowed) throw new TrackingLookupError('RATE_LIMITED');
  }

  private async getSafeProjection(
    orderId: string,
    settings: Awaited<ReturnType<typeof loadFulfilmentSettings>>,
  ): Promise<TrackingLookupResult> {
    const deliveryReference = this.firestore
      .collection(firestoreCollections.deliveries)
      .doc(orderId);
    const [deliverySnapshot, eventsSnapshot] = await Promise.all([
      deliveryReference.get(),
      deliveryReference
        .collection(firestoreCollections.deliveryEvents)
        .orderBy('occurredAt', 'asc')
        .limit(100)
        .get(),
    ]);
    const deliveryParse = deliveryDocumentSchema.safeParse(deliverySnapshot.data());
    if (!deliverySnapshot.exists || !deliveryParse.success) {
      throw new TrackingLookupError('NOT_FOUND');
    }
    const delivery = deliveryParse.data;
    const timeline = eventsSnapshot.docs.flatMap((eventSnapshot) => {
      const eventParse = deliveryEventDocumentSchema.safeParse(eventSnapshot.data());
      if (!eventParse.success) return [];
      const event = eventParse.data;
      return [
        {
          id: eventSnapshot.id,
          status: event.nextStatus,
          label: event.customerLabel,
          note: event.customerNote,
          occurredAt: new Date(
            'toDate' in event.occurredAt
              ? event.occurredAt.toDate().getTime()
              : event.occurredAt.getTime(),
          ).toISOString(),
        },
      ];
    });
    const whatsappPhone = settings.supportWhatsappPhone;
    return {
      reference: delivery.orderReference,
      method: delivery.method,
      status: delivery.status,
      statusLabel: customerStatusLabels[delivery.status],
      estimate: {
        label: delivery.estimate.label,
        earliestDate: delivery.estimate.earliestDate,
        latestDate: delivery.estimate.latestDate,
      },
      destinationLabel:
        delivery.method === 'delivery'
          ? `${delivery.zoneSnapshot?.name ?? 'Lagos'} delivery zone`
          : delivery.pickupSnapshot?.label ?? 'BridgegateShop pickup',
      timeline,
      supportWhatsappUrl: whatsappPhone
        ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(
            `Hello BridgegateShop, I need help with order ${delivery.orderReference}.`,
          )}`
        : null,
    };
  }
}

export function createTrackingService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreTrackingService(firestore);
}
