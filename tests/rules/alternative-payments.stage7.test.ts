import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getCheckoutSettings, type CheckoutSettings } from '@/lib/config/checkoutSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { createCartService, type CartIdentity } from '@/lib/services/carts/CartService';
import { createCheckoutService } from '@/lib/services/orders/CheckoutService';
import { createOrderCancellationService } from '@/lib/services/orders/OrderCancellationService';
import { createAlternativePaymentService } from '@/lib/services/payments/AlternativePaymentService';
import type {
  PaymentProvider,
  RefundProvider,
} from '@/lib/services/payments/PaystackClient';
import { createPaystackWebhookService } from '@/lib/services/payments/PaystackWebhookService';
import { createRefundService } from '@/lib/services/payments/RefundService';
import { createReturnStockService } from '@/lib/services/payments/ReturnStockService';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
const signatureVariantId = 'variant-product-signature-pop';
let testEnvironment: RulesTestEnvironment;

const settings: CheckoutSettings = {
  ...getCheckoutSettings(),
  configurationVersion: 'stage7-test-v1',
  deliveryZones: getCheckoutSettings().deliveryZones.map((zone) => ({
    ...zone,
    podEligible: zone.id === 'lagos-mainland',
  })),
  podReservationMinutes: 60,
  manualTransferReservationHours: 24,
  pod: {
    enabled: true,
    allowedZoneIds: ['lagos-mainland'],
    excludedProductIds: [],
    excludedVariantIds: [],
    restrictedOwnerUids: [],
    restrictedEmails: [],
    minimumOrderKobo: 0,
    maximumOrderKobo: 50_000_000,
    depositThresholdKobo: 1_600_000,
    depositBasisPoints: 3_000,
    confirmationMode: 'staffApproval',
    holdMinutes: 60,
  },
  manualTransfer: {
    enabled: true,
    holdHours: 24,
    allowPartialPayments: false,
    evidenceUploadEnabled: false,
    evidenceRetentionDays: 365,
    instructionsVersion: 'stage7-test-v1',
    instructions: {
      bankName: 'Bridgegate Test Bank',
      accountName: 'Bridgegate Shop Test',
      accountNumber: '0123456789',
      customerMessage: 'Use the order reference as narration.',
    },
  },
  financialDocuments: {
    businessName: 'Bridgegate Shop Test',
    businessAddress: '12 Test Avenue, Lagos',
    businessEmail: 'orders@example.com',
    businessPhone: '+2348030000000',
    registrationNumber: null,
    taxNumber: null,
  },
  paymentMethods: {
    paystack: {
      enabled: true,
      customerLabel: 'Pay online with Paystack',
      unavailableReason: null,
    },
    pod: {
      enabled: true,
      customerLabel: 'Pay on Delivery',
      unavailableReason: null,
    },
    manualTransfer: {
      enabled: true,
      customerLabel: 'Manual Bank Transfer',
      unavailableReason: null,
    },
  },
};

const staffActor = {
  actorId: 'staff-stage7-finance',
  roleIds: ['administrator'] as const,
  requestId: 'request-stage7-finance-001',
};

const manualRefundProvider: RefundProvider = {
  async createRefund() {
    throw new Error('Manual refunds must not call Paystack.');
  },
};

function checkoutInput(
  paymentMethod: 'paystack' | 'pod' | 'manualTransfer',
  version: number,
  idempotencyKey: string,
) {
  return {
    fullName: 'Ada Okafor',
    email: 'ada@example.com',
    phone: '+2348031234567',
    company: null,
    customerNote: null,
    fulfilmentMethod: 'delivery' as const,
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
    paymentMethod,
    expectedCartVersion: version,
    idempotencyKey,
    termsAccepted: true as const,
    privacyAccepted: true as const,
  };
}

async function createOrder(
  method: 'paystack' | 'pod' | 'manualTransfer',
  tokenCharacter: string,
  idempotencyKey: string,
  checkoutSettings: CheckoutSettings = settings,
) {
  const firestore = getFirebaseAdminFirestore();
  const cartService = createCartService(firestore);
  const identity = await cartService.createGuestCart(tokenCharacter.repeat(64));
  await cartService.addItem(identity, signatureVariantId, 1);
  const cart = await cartService.getCart(identity);
  const creation = await createCheckoutService(firestore, checkoutSettings).createOrder(
    identity,
    checkoutInput(method, cart.version!, idempotencyKey),
  );
  return { creation, identity };
}

function orderProof(identity: CartIdentity) {
  return {
    ownerUid: identity.ownerUid,
    guestTokenHash: identity.guestTokenHash,
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

describe('Stage 6 alternative payments, documents, cancellation, and refunds', () => {
  it('approves an exact-threshold zero-deposit POD order exactly once', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation } = await createOrder(
      'pod',
      'a',
      'checkout-stage7-pod-001',
    );

    expect(creation.order.totals.grandTotalKobo).toBe(1_600_000);
    expect(creation.order.paymentSelection).toMatchObject({
      method: 'pod',
      depositKobo: 0,
      outstandingAfterInitialPaymentKobo: 1_600_000,
    });
    expect(creation.paymentAttempt).toBeNull();
    expect(creation.order).toMatchObject({
      orderStatus: 'pending',
      paymentStatus: 'unpaid',
    });

    const service = createAlternativePaymentService(firestore, settings);
    const input = {
      orderId: creation.order.id,
      expectedOrderVersion: creation.order.version,
      idempotencyKey: 'pod-approval-stage7-001',
    };
    const approved = await service.approvePodOrder(input, staffActor);
    const replay = await service.approvePodOrder(input, staffActor);
    const [reservation, balance, documents] = await Promise.all([
      firestore
        .collection(firestoreCollections.inventoryReservations)
        .doc(creation.order.reservationId)
        .get(),
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(signatureVariantId)
        .get(),
      firestore
        .collection(firestoreCollections.financialDocuments)
        .where('orderId', '==', creation.order.id)
        .get(),
    ]);

    expect(approved.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(approved.order.orderStatus).toBe('confirmed');
    expect(reservation.data()).toMatchObject({ state: 'committed' });
    expect(balance.data()).toMatchObject({ onHand: 39, reserved: 0, available: 39 });
    expect(documents.size).toBe(1);
    expect(documents.docs[0].data()).toMatchObject({ documentType: 'invoice' });
  });

  it('keeps a POD deposit partially paid until the exact collection is posted once', async () => {
    const firestore = getFirebaseAdminFirestore();
    const depositSettings: CheckoutSettings = {
      ...settings,
      pod: { ...settings.pod, depositThresholdKobo: 1_000_000 },
    };
    const { creation } = await createOrder(
      'pod',
      'e',
      'checkout-stage7-pod-deposit-001',
      depositSettings,
    );
    const attempt = creation.paymentAttempt!;
    expect(attempt.intendedAmountKobo).toBe(480_000);
    const provider: PaymentProvider = {
      async initialiseTransaction() {
        throw new Error('Initialisation is not used in this webhook test.');
      },
      async verifyTransaction(providerReference) {
        return {
          providerTransactionId: 'stage7-pod-deposit-transaction',
          providerReference,
          amountKobo: attempt.intendedAmountKobo,
          currency: 'NGN',
          status: 'success',
          paidAt: new Date('2026-08-01T12:30:00.000Z'),
          channel: 'card',
          safeMessage: 'Verified',
          safeResponseHashInput: 'stage7-pod-deposit-safe-response',
        };
      },
    };
    const rawEvent = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 'stage7-pod-deposit-transaction',
        reference: attempt.providerReference,
        amount: attempt.intendedAmountKobo,
        currency: 'NGN',
        status: 'success',
      },
    });
    await createPaystackWebhookService(
      firestore,
      provider,
      depositSettings,
    ).processSignedEvent(rawEvent);
    const partiallyPaidSnapshot = await firestore
      .collection(firestoreCollections.orders)
      .doc(creation.order.id)
      .get();
    expect(partiallyPaidSnapshot.data()).toMatchObject({
      orderStatus: 'confirmed',
      paymentStatus: 'partiallyPaid',
      totals: {
        amountPaidKobo: 480_000,
        amountOutstandingKobo: 1_120_000,
      },
    });

    const input = {
      orderId: creation.order.id,
      amountKobo: 1_120_000,
      externalReference: 'POD-STAGE7-COLLECTION-001',
      transactionDate: new Date('2026-08-02T12:30:00.000Z'),
      note: 'Collected on delivery.',
      evidenceId: null,
      expectedOrderVersion: Number(partiallyPaidSnapshot.data()?.version),
      idempotencyKey: 'pod-stage7-collection-001',
    };
    const service = createAlternativePaymentService(firestore, depositSettings);
    const collected = await service.recordPodCollection(input, staffActor);
    const replay = await service.recordPodCollection(input, staffActor);
    const [payments, documents, balance] = await Promise.all([
      firestore.collection(firestoreCollections.payments).where('orderId', '==', creation.order.id).get(),
      firestore.collection(firestoreCollections.financialDocuments).where('orderId', '==', creation.order.id).get(),
      firestore.collection(firestoreCollections.inventoryBalances).doc(signatureVariantId).get(),
    ]);

    expect(collected.order).toMatchObject({ paymentStatus: 'paid' });
    expect(collected.order.totals).toMatchObject({
      amountPaidKobo: 1_600_000,
      amountOutstandingKobo: 0,
    });
    expect(replay.replay).toBe(true);
    expect(payments.size).toBe(2);
    expect(documents.docs.map((document) => document.data().documentType).sort()).toEqual([
      'invoice',
      'receipt',
      'receipt',
    ]);
    expect(balance.data()).toMatchObject({ onHand: 39, reserved: 0, available: 39 });
  });

  it('protects full manual-transfer posting with exact amount and reference deduplication', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation } = await createOrder(
      'manualTransfer',
      'b',
      'checkout-stage7-transfer-001',
    );
    const service = createAlternativePaymentService(firestore, settings);
    const instruction = await firestore
      .collection(firestoreCollections.transferInstructions)
      .doc(creation.order.id)
      .get();
    expect(instruction.data()).toMatchObject({
      orderId: creation.order.id,
      settingsVersion: 'stage7-test-v1',
      accountNumber: '0123456789',
    });

    await expect(
      service.recordManualTransfer(
        {
          orderId: creation.order.id,
          amountKobo: creation.order.totals.grandTotalKobo - 1,
          externalReference: 'TRF-STAGE7-001',
          transactionDate: new Date('2026-08-01T13:00:00.000Z'),
          note: null,
          evidenceId: null,
          expectedOrderVersion: creation.order.version,
          idempotencyKey: 'transfer-stage7-partial-001',
        },
        staffActor,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const input = {
      orderId: creation.order.id,
      amountKobo: creation.order.totals.grandTotalKobo,
      externalReference: 'TRF-STAGE7-001',
      transactionDate: new Date('2026-08-01T13:00:00.000Z'),
      note: 'Verified against the bank statement.',
      evidenceId: null,
      expectedOrderVersion: creation.order.version,
      idempotencyKey: 'transfer-stage7-full-001',
    };
    const posted = await service.recordManualTransfer(input, staffActor);
    const replay = await service.recordManualTransfer(input, staffActor);
    await expect(
      service.recordManualTransfer(
        { ...input, idempotencyKey: 'transfer-stage7-conflict-001' },
        staffActor,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const [balance, payments, documents] = await Promise.all([
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(signatureVariantId)
        .get(),
      firestore
        .collection(firestoreCollections.payments)
        .where('orderId', '==', creation.order.id)
        .get(),
      firestore
        .collection(firestoreCollections.financialDocuments)
        .where('orderId', '==', creation.order.id)
        .get(),
    ]);
    expect(posted.order).toMatchObject({ orderStatus: 'confirmed', paymentStatus: 'paid' });
    expect(replay.replay).toBe(true);
    expect(balance.data()).toMatchObject({ onHand: 39, reserved: 0, available: 39 });
    expect(payments.size).toBe(1);
    expect(documents.docs.map((document) => document.data().documentType).sort()).toEqual([
      'invoice',
      'receipt',
    ]);
  });

  it('cancels an unpaid held order idempotently and releases its reservation', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation } = await createOrder(
      'paystack',
      'c',
      'checkout-stage7-cancel-001',
    );
    const service = createOrderCancellationService(firestore);
    const input = {
      orderId: creation.order.id,
      reason: 'Customer requested cancellation before payment.',
      expectedOrderVersion: creation.order.version,
      idempotencyKey: 'cancel-stage7-order-001',
    };
    const cancelled = await service.cancelOrder(input, staffActor);
    const replay = await service.cancelOrder(input, staffActor);
    const [reservation, balance] = await Promise.all([
      firestore
        .collection(firestoreCollections.inventoryReservations)
        .doc(creation.order.reservationId)
        .get(),
      firestore
        .collection(firestoreCollections.inventoryBalances)
        .doc(signatureVariantId)
        .get(),
    ]);

    expect(cancelled.order).toMatchObject({
      orderStatus: 'cancelled',
      fulfilmentStatus: 'cancelled',
    });
    expect(replay.replay).toBe(true);
    expect(reservation.data()).toMatchObject({ state: 'released' });
    expect(balance.data()).toMatchObject({ onHand: 40, reserved: 0, available: 40 });
  });

  it('bounds and processes a refund without restocking until a physical return is accepted', async () => {
    const firestore = getFirebaseAdminFirestore();
    const { creation, identity } = await createOrder(
      'manualTransfer',
      'd',
      'checkout-stage7-refund-001',
    );
    const posted = await createAlternativePaymentService(
      firestore,
      settings,
    ).recordManualTransfer(
      {
        orderId: creation.order.id,
        amountKobo: creation.order.totals.grandTotalKobo,
        externalReference: 'TRF-STAGE7-REFUND-001',
        transactionDate: new Date('2026-08-01T14:00:00.000Z'),
        note: 'Verified.',
        evidenceId: null,
        expectedOrderVersion: creation.order.version,
        idempotencyKey: 'transfer-stage7-refund-001',
      },
      staffActor,
    );
    const refundService = createRefundService(
      firestore,
      manualRefundProvider,
      settings,
    );
    const requested = await refundService.requestRefund(
      {
        orderId: creation.order.id,
        paymentId: posted.paymentId,
        amountKobo: creation.order.totals.grandTotalKobo,
        reason: 'Customer returned the item.',
        idempotencyKey: 'refund-stage7-request-001',
      },
      orderProof(identity),
    );
    const replay = await refundService.requestRefund(
      {
        orderId: creation.order.id,
        paymentId: posted.paymentId,
        amountKobo: creation.order.totals.grandTotalKobo,
        reason: 'Customer returned the item.',
        idempotencyKey: 'refund-stage7-request-001',
      },
      orderProof(identity),
    );
    await expect(
      refundService.requestRefund(
        {
          orderId: creation.order.id,
          paymentId: posted.paymentId,
          amountKobo: 1,
          reason: 'Duplicate excess request.',
          idempotencyKey: 'refund-stage7-request-002',
        },
        orderProof(identity),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const reviewed = await refundService.reviewRefund(
      {
        refundId: requested.refund.id,
        decision: 'approved',
        expectedOrderVersion: posted.order.version,
        resolutionNote: 'Approved after finance review.',
        idempotencyKey: 'refund-stage7-approve-001',
      },
      staffActor,
    );
    const processing = await refundService.processApprovedRefund(
      requested.refund.id,
      staffActor,
    );
    const processed = await refundService.recordRefundOutcome(
      {
        refundId: requested.refund.id,
        outcome: 'processed',
        providerRefundId: 'MANUAL-REFUND-STAGE7-001',
        resolutionNote: 'Manual refund confirmed on bank statement.',
        idempotencyKey: 'refund-stage7-outcome-001',
      },
      staffActor,
    );
    const balanceBeforeReturn = await firestore
      .collection(firestoreCollections.inventoryBalances)
      .doc(signatureVariantId)
      .get();
    const creditNotes = await firestore
      .collection(firestoreCollections.financialDocuments)
      .where('refundId', '==', requested.refund.id)
      .get();

    expect(replay.replay).toBe(true);
    expect(reviewed.refund.state).toBe('approved');
    expect(processing.refund.state).toBe('processing');
    expect(processed.order).toMatchObject({ paymentStatus: 'refunded' });
    expect(processed.refund).toMatchObject({
      state: 'processed',
      stockDecision: 'notRestocked',
    });
    expect(balanceBeforeReturn.data()).toMatchObject({ onHand: 39, available: 39 });
    expect(creditNotes.size).toBe(1);
    expect(creditNotes.docs[0].data()).toMatchObject({ documentType: 'creditNote' });

    await firestore
      .collection(firestoreCollections.orders)
      .doc(creation.order.id)
      .update({ orderStatus: 'completed', fulfilmentStatus: 'delivered' });
    const returned = await createReturnStockService(firestore).acceptFullReturn(
      requested.refund.id,
      'Returned item inspected and accepted in sellable condition.',
      staffActor,
    );
    const returnReplay = await createReturnStockService(firestore).acceptFullReturn(
      requested.refund.id,
      'Returned item inspected and accepted in sellable condition.',
      staffActor,
    );
    const balanceAfterReturn = await firestore
      .collection(firestoreCollections.inventoryBalances)
      .doc(signatureVariantId)
      .get();

    expect(returned.replay).toBe(false);
    expect(returnReplay.replay).toBe(true);
    expect(balanceAfterReturn.data()).toMatchObject({ onHand: 40, available: 40 });
  });
});
