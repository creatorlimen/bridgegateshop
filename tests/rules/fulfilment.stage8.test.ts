import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

vi.mock('server-only', () => ({}));

import { getCheckoutSettings, type CheckoutSettings } from '@/lib/config/checkoutSettings';
import type { NotificationRuntimeSettings } from '@/lib/config/notificationSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { createCartService } from '@/lib/services/carts/CartService';
import { createDeliveryOverdueService } from '@/lib/services/fulfilment/DeliveryOverdueService';
import { createDeliveryTransitionService } from '@/lib/services/fulfilment/DeliveryTransitionService';
import { createTrackingService, TrackingLookupError } from '@/lib/services/fulfilment/TrackingService';
import { createNotificationService } from '@/lib/services/notifications/NotificationService';
import type { NotificationProvider } from '@/lib/services/notifications/NotificationProvider';
import { createCheckoutService } from '@/lib/services/orders/CheckoutService';
import { createFulfilmentOutboxWorker } from '@/lib/services/outbox/FulfilmentOutboxWorker';
import { createAlternativePaymentService } from '@/lib/services/payments/AlternativePaymentService';
import { createFulfilmentSettingsService } from '@/lib/services/settings/FulfilmentSettingsService';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
const variantId = 'variant-product-signature-pop';
let testEnvironment: RulesTestEnvironment;

const baseSettings = getCheckoutSettings();
const settings: CheckoutSettings = {
  ...baseSettings,
  configurationVersion: 'stage8-payments-v1',
  fulfilmentConfigurationVersion: 'stage8-fulfilment-v1',
  deliveryZones: baseSettings.deliveryZones.map((zone) => ({
    ...zone,
    podEligible: zone.id === 'lagos-mainland',
  })),
  pod: {
    enabled: true,
    allowedZoneIds: ['lagos-mainland'],
    excludedProductIds: [],
    excludedVariantIds: [],
    restrictedOwnerUids: [],
    restrictedEmails: [],
    minimumOrderKobo: 0,
    maximumOrderKobo: 50_000_000,
    depositThresholdKobo: 5_000_000,
    depositBasisPoints: 3_000,
    confirmationMode: 'staffApproval',
    holdMinutes: 60,
  },
  manualTransfer: {
    ...baseSettings.manualTransfer,
    enabled: true,
    allowPartialPayments: false,
    evidenceUploadEnabled: false,
  },  paymentMethods: {
    ...baseSettings.paymentMethods,
    pod: {
      enabled: true,
      customerLabel: 'Pay on Delivery',
      unavailableReason: null,
    },
    manualTransfer: {
      enabled: true,
      customerLabel: 'Manual Bank Transfer',
      unavailableReason: null,
    },  },
};

const staffActor = {
  actorId: 'stage8-fulfilment-staff',
  roleIds: ['fulfilmentStaff'] as const,
  requestId: 'stage8-request-001',
};

function checkoutInput(
  method: 'delivery' | 'pickup',
  version: number,
  idempotencyKey: string,
) {
  const common = {
    fullName: 'Ada Okafor',
    email: 'ada@example.com',
    phone: '+2348031234567',
    company: null,
    customerNote: null,
    paymentMethod: 'pod' as const,
    expectedCartVersion: version,
    idempotencyKey,
    termsAccepted: true as const,
    privacyAccepted: true as const,
  };
  if (method === 'delivery') {
    return {
      ...common,
      fulfilmentMethod: 'delivery' as const,
      paymentMethod: 'pod' as const,
      deliveryAddress: {
        recipientName: 'Ada Okafor',
        phone: '+2348031234567',
        line1: '12 Test Street',
        line2: null,
        landmark: null,
        city: 'Lagos',
        state: 'Lagos' as const,
        zoneId: 'lagos-mainland',
      },
    };
  }
  return {
    ...common,
    fulfilmentMethod: 'pickup' as const,
    paymentMethod: 'manualTransfer' as const,
    deliveryAddress: null,
  };
}
async function createApprovedOrder(method: 'delivery' | 'pickup', token: string) {
  const firestore = getFirebaseAdminFirestore();
  const cartService = createCartService(firestore);
  const identity = await cartService.createGuestCart(token.repeat(64));
  await cartService.addItem(identity, variantId, 1);
  const cart = await cartService.getCart(identity);
  const creation = await createCheckoutService(firestore, settings).createOrder(
    identity,
    checkoutInput(method, cart.version!, `checkout-stage8-${token.repeat(4)}-001`),
  );
  const paymentService = createAlternativePaymentService(firestore, settings);
  const approved = method === 'delivery'
    ? await paymentService.approvePodOrder(
        {
          orderId: creation.order.id,
          expectedOrderVersion: creation.order.version,
          idempotencyKey: `pod-approval-stage8-${token.repeat(4)}-001`,
        },
        staffActor,
      )
    : await paymentService.recordManualTransfer(
        {
          orderId: creation.order.id,
          amountKobo: creation.order.totals.amountOutstandingKobo,
          externalReference: `TRANSFER-STAGE8-${token.repeat(4)}-001`,
          transactionDate: new Date('2026-08-01T12:00:00.000Z'),
          note: 'Verified pickup payment.',
          evidenceId: null,
          expectedOrderVersion: creation.order.version,
          idempotencyKey: `transfer-stage8-${token.repeat(4)}-001`,
        },
        staffActor,
      );  return { creation, approved, identity };
}

function transitionInput(
  deliveryId: string,
  deliveryVersion: number,
  orderVersion: number,
  nextStatus:
    | 'unfulfilled'
    | 'preparing'
    | 'readyForPickup'
    | 'dispatched'
    | 'outForDelivery'
    | 'delivered'
    | 'collected',
  suffix: string,
) {
  return {
    deliveryId,
    nextStatus,
    expectedDeliveryVersion: deliveryVersion,
    expectedOrderVersion: orderVersion,
    customerNote: null,
    internalNote: null,
    courierName: nextStatus === 'dispatched' ? 'Stage 8 Courier' : null,
    trackingReference: nextStatus === 'dispatched' ? 'STAGE8-TRACK-001' : null,
    idempotencyKey: `delivery-stage8-${suffix}-001`,
  };
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedCatalogue(getFirebaseAdminFirestore());
});

afterAll(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.cleanup();
});

describe('Stage 8 fulfilment, tracking, and notifications', () => {
  it('atomically snapshots the accepted zone, estimate, and configuration version', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation } = await createApprovedOrder('delivery', 'f');
    const delivery = await firestore
      .collection(firestoreCollections.deliveries)
      .doc(creation.order.id)
      .get();

    expect(delivery.data()).toMatchObject({
      orderId: creation.order.id,
      method: 'delivery',
      status: 'unfulfilled',
      configurationVersion: 'stage8-fulfilment-v1',
      zoneSnapshot: {
        zoneId: 'lagos-mainland',
        feeKobo: 350_000,
      },
      estimate: {
        configurationVersion: 'stage8-fulfilment-v1',
      },
    });
    expect(creation.order.fulfilment).toMatchObject({
      configurationVersion: 'stage8-fulfilment-v1',
    });
  });

  it('guards and replays the delivery state machine while coupling completion to payment', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation, approved } = await createApprovedOrder('delivery', 'a');
    const service = createDeliveryTransitionService(firestore);
    const initialDelivery = await firestore.collection(firestoreCollections.deliveries).doc(creation.order.id).get();
    const initialVersion = Number(initialDelivery.data()?.version);

    await expect(
      service.transition(
        transitionInput(creation.order.id, initialVersion, approved.order.version, 'dispatched', 'invalid-skip'),
        staffActor,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const prepareInput = transitionInput(
      creation.order.id,
      initialVersion,
      approved.order.version,
      'preparing',
      'prepare',
    );
    const prepared = await service.transition(prepareInput, staffActor);
    const replay = await service.transition(prepareInput, staffActor);
    expect(replay.replay).toBe(true);

    const dispatched = await service.transition(
      transitionInput(creation.order.id, prepared.delivery.version, prepared.order.version, 'dispatched', 'dispatch'),
      staffActor,
    );
    const outForDelivery = await service.transition(
      transitionInput(creation.order.id, dispatched.delivery.version, dispatched.order.version, 'outForDelivery', 'out'),
      staffActor,
    );
    const delivered = await service.transition(
      transitionInput(creation.order.id, outForDelivery.delivery.version, outForDelivery.order.version, 'delivered', 'delivered'),
      staffActor,
    );

    expect(delivered.delivery.status).toBe('delivered');
    expect(delivered.order).toMatchObject({
      orderStatus: 'processing',
      fulfilmentStatus: 'delivered',
    });
    const paid = await createAlternativePaymentService(firestore, settings).recordPodCollection(
      {
        orderId: creation.order.id,
        amountKobo: delivered.order.totals.amountOutstandingKobo,
        externalReference: 'POD-STAGE8-DELIVERED-001',
        transactionDate: new Date('2026-08-01T12:30:00.000Z'),
        note: 'Collected after delivery.',
        evidenceId: null,
        expectedOrderVersion: delivered.order.version,
        idempotencyKey: 'pod-stage8-delivered-payment-001',
      },
      staffActor,
    );
    expect(paid.order).toMatchObject({
      orderStatus: 'completed',
      paymentStatus: 'paid',
      fulfilmentStatus: 'delivered',
    });
  });

  it('uses the pickup-only route and flags a one-step reversal', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation, approved } = await createApprovedOrder('pickup', 'b');
    const deliverySnapshot = await firestore.collection(firestoreCollections.deliveries).doc(creation.order.id).get();
    const service = createDeliveryTransitionService(firestore);
    const prepared = await service.transition(
      transitionInput(creation.order.id, Number(deliverySnapshot.data()?.version), approved.order.version, 'preparing', 'pickup-prepare'),
      staffActor,
    );
    const ready = await service.transition(
      transitionInput(creation.order.id, prepared.delivery.version, prepared.order.version, 'readyForPickup', 'pickup-ready'),
      staffActor,
    );
    const reverted = await service.revert(
      {
        ...transitionInput(creation.order.id, ready.delivery.version, ready.order.version, 'preparing', 'pickup-revert'),
        reason: 'Package requires another quality check.',
      },
      staffActor,
    );
    const exceptions = await firestore
      .collection(firestoreCollections.deliveryExceptions)
      .where('deliveryId', '==', creation.order.id)
      .get();

    expect(reverted.delivery).toMatchObject({
      status: 'preparing',
      exceptionFlags: ['revertedStatus'],
    });
    expect(exceptions.docs[0].data()).toMatchObject({
      type: 'revertedStatus',
      state: 'open',
    });
  });

  it('sends each customer-visible delivery event once and keeps one append-only attempt', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation, approved } = await createApprovedOrder('delivery', 'c');
    const deliverySnapshot = await firestore.collection(firestoreCollections.deliveries).doc(creation.order.id).get();
    const prepared = await createDeliveryTransitionService(firestore).transition(
      transitionInput(creation.order.id, Number(deliverySnapshot.data()?.version), approved.order.version, 'preparing', 'notify'),
      staffActor,
    );
    let sends = 0;
    const provider: NotificationProvider = {
      name: 'stage8-stub',
      async send() {
        sends += 1;
        return { providerMessageId: 'stage8-message-001', safeMessage: 'Accepted' };
      },
    };
    const notificationSettings: NotificationRuntimeSettings = {
      configurationVersion: 'stage8-notifications-v1',
      email: {
        enabled: true,
        fromName: 'BridgegateShop',
        fromEmail: 'orders@example.com',
        replyToEmail: null,
        maximumAttempts: 3,
      },
      sms: {
        enabled: false,
        senderId: 'Bridgegate',
        enabledStatuses: [],
        maximumAttempts: 3,
      },
    };
    const notificationService = createNotificationService({
      firestore,
      settings: notificationSettings,
      providers: { email: provider, sms: provider },
      baseUrl: 'https://bridgegateshop.example',
    });
    await notificationService.processDeliveryEvent(creation.order.id, prepared.deliveryEventId);
    await notificationService.processDeliveryEvent(creation.order.id, prepared.deliveryEventId);
    const [events, attempts] = await Promise.all([
      firestore.collection(firestoreCollections.notificationEvents).get(),
      firestore.collection(firestoreCollections.notificationAttempts).get(),
    ]);

    expect(sends).toBe(1);
    expect(events.size).toBe(1);
    expect(events.docs[0].data()).toMatchObject({ state: 'sent', attemptCount: 1 });
    expect(attempts.size).toBe(1);
  });

  it('claims, processes, retries, and dead-letters fulfilment outbox events', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation, approved } = await createApprovedOrder('delivery', 'e');
    const deliverySnapshot = await firestore
      .collection(firestoreCollections.deliveries)
      .doc(creation.order.id)
      .get();
    const transitionService = createDeliveryTransitionService(firestore);
    const prepared = await transitionService.transition(
      transitionInput(
        creation.order.id,
        Number(deliverySnapshot.data()?.version),
        approved.order.version,
        'preparing',
        'outbox-processed',
      ),
      staffActor,
    );
    const processed = await createFulfilmentOutboxWorker({
      firestore,
      notificationProcessorFactory: async () => ({
        async processDeliveryEvent() {
          return [{ channel: 'email', state: 'sent', terminal: true, replay: false }];
        },
      }),
    }).processDueEvents();
    expect(processed).toMatchObject({ claimed: 1, processed: 1 });

    await transitionService.transition(
      transitionInput(
        creation.order.id,
        prepared.delivery.version,
        prepared.order.version,
        'dispatched',
        'outbox-retry',
      ),
      staffActor,
    );
    const retryWorker = createFulfilmentOutboxWorker({
      firestore,
      notificationProcessorFactory: async () => ({
        async processDeliveryEvent() {
          return [{ channel: 'email', state: 'failed', terminal: false, replay: false }];
        },
      }),
    });
    expect(await retryWorker.processDueEvents()).toMatchObject({
      claimed: 1,
      retried: 1,
    });
    const pendingEvents = await firestore
      .collection(firestoreCollections.outboxEvents)
      .where('eventName', '==', 'fulfilment.updated')
      .where('state', '==', 'pending')
      .get();
    expect(pendingEvents.size).toBe(1);
    await pendingEvents.docs[0].ref.update({
      attemptCount: 4,
      nextAttemptAt: Timestamp.fromMillis(0),
    });
    const deadLettered = await createFulfilmentOutboxWorker({
      firestore,
      notificationProcessorFactory: async () => ({
        async processDeliveryEvent() {
          return [{ channel: 'email', state: 'failed', terminal: true, replay: false }];
        },
      }),
    }).processDueEvents();
    expect(deadLettered).toMatchObject({ claimed: 1, deadLettered: 1 });
    const notificationExceptions = await firestore
      .collection(firestoreCollections.deliveryExceptions)
      .where('deliveryId', '==', creation.order.id)
      .where('type', '==', 'notificationFailed')
      .get();
    expect(notificationExceptions.size).toBe(1);
  });

  it('flags overdue active deliveries once using the Lagos local date', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation } = await createApprovedOrder('delivery', '6');
    await firestore
      .collection(firestoreCollections.deliveries)
      .doc(creation.order.id)
      .update({
        'estimate.earliestDate': '2026-08-03',
        'estimate.latestDate': '2026-08-03',
      });
    const service = createDeliveryOverdueService(firestore);
    expect(
      await service.flagOverdueDeliveries({ now: new Date('2026-08-04T12:00:00.000Z') }),
    ).toMatchObject({ localDate: '2026-08-04', inspected: 1, flagged: 1 });
    expect(
      await service.flagOverdueDeliveries({ now: new Date('2026-08-04T12:00:00.000Z') }),
    ).toMatchObject({ localDate: '2026-08-04', inspected: 1, replayed: 1 });
  });

  it('returns a privacy-minimized tracking projection and enforces independent limits', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation, approved, identity } = await createApprovedOrder('delivery', 'd');
    const deliverySnapshot = await firestore.collection(firestoreCollections.deliveries).doc(creation.order.id).get();
    await createDeliveryTransitionService(firestore).transition(
      transitionInput(creation.order.id, Number(deliverySnapshot.data()?.version), approved.order.version, 'preparing', 'tracking'),
      { ...staffActor, requestId: 'stage8-tracking-transition' },
    );
    await createFulfilmentSettingsService(firestore).saveGlobal(
      {
        expectedVersion: 0,
        pickup: settings.pickup,
        supportWhatsappPhone: '2348030000000',
        trackingRateLimit: {
          windowMinutes: 15,
          maximumAttemptsPerIp: 2,
          maximumAttemptsPerReference: 2,
          maximumAttemptsPerFactor: 2,
        },
      },
      { actorId: 'stage8-admin', roleIds: ['administrator'], requestId: 'stage8-settings-001' },
    );
    const service = createTrackingService(firestore);
    await expect(
      service.lookupWithFactor({
        reference: creation.order.reference,
        factor: 'wrong@example.com',
        ipAddress: '203.0.113.20',
      }),
    ).rejects.toBeInstanceOf(TrackingLookupError);
    const result = await service.lookupWithFactor({
      reference: creation.order.reference,
      factor: 'ada@example.com',
      ipAddress: '203.0.113.20',
    });

    expect(result).toMatchObject({
      reference: creation.order.reference,
      status: 'preparing',
      destinationLabel: 'Lagos Mainland delivery zone',
    });
    expect(result.supportWhatsappUrl).toContain('wa.me/2348030000000');
    expect(result).not.toHaveProperty('deliveryAddress');
    expect(result).not.toHaveProperty('courierName');
    expect(result.timeline[0]).not.toHaveProperty('internalNote');
    await expect(
      service.lookupForOwner(creation.order.reference, {
        ownerUid: null,
        guestTokenHash: identity.guestTokenHash,
      }),
    ).resolves.toMatchObject({ reference: creation.order.reference, status: 'preparing' });
    await expect(
      service.lookupWithFactor({
        reference: creation.order.reference,
        factor: 'ada@example.com',
        ipAddress: '203.0.113.20',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});




