import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getCheckoutSettings } from '@/lib/config/checkoutSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { createCartService } from '@/lib/services/carts/CartService';
import { createCheckoutService } from '@/lib/services/orders/CheckoutService';
import { createOrderReservationExpiryService } from '@/lib/services/orders/OrderReservationExpiryService';
import type {
  PaymentInitialisation,
  PaymentProvider,
  PaymentRedirect,
  VerifiedPayment,
} from '@/lib/services/payments/PaystackClient';
import { createPaystackWebhookService } from '@/lib/services/payments/PaystackWebhookService';
import { createPaymentAttemptService } from '@/lib/services/payments/PaymentAttemptService';
import { seedCatalogue } from '@/tests/helpers/seedCatalogue';

const projectId = 'demo-bridgegate-shop';
const signatureVariantId = 'variant-product-signature-pop';
let testEnvironment: RulesTestEnvironment;

const stage6Settings = {
  ...getCheckoutSettings(),
  paymentMethods: {
    ...getCheckoutSettings().paymentMethods,
    paystack: {
      enabled: true,
      customerLabel: 'Pay online with Paystack',
      unavailableReason: null,
    },
  },
};

function checkoutInput(version: number, idempotencyKey = 'checkout-stage6-test-001') {
  return {
    fullName: 'Ada Okafor',
    email: 'ada@example.com',
    phone: '+2348031234567',
    company: null,
    customerNote: 'Call before delivery.',
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
    paymentMethod: 'paystack' as const,
    expectedCartVersion: version,
    idempotencyKey,
    termsAccepted: true as const,
    privacyAccepted: true as const,
  };
}

class StubPaystackProvider implements PaymentProvider {
  constructor(private readonly verification: Omit<VerifiedPayment, 'providerReference'> & { providerReference?: string }) {}

  async initialiseTransaction(input: PaymentInitialisation): Promise<PaymentRedirect> {
    return {
      authorizationUrl: 'https://checkout.paystack.com/stage6test',
      accessCode: 'stage6test',
      providerReference: input.reference,
      safeMessage: 'Authorization URL created',
    };
  }

  async verifyTransaction(providerReference: string): Promise<VerifiedPayment> {
    return { ...this.verification, providerReference: this.verification.providerReference ?? providerReference };
  }
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

describe('Stage 6 checkout, order, and Paystack orchestration', () => {
  it('creates one immutable order and reservation for a replayed checkout', async () => {
    const firestore = getFirebaseAdminFirestore();
    const cartService = createCartService(firestore);
    const identity = await cartService.createGuestCart('6'.repeat(64));
    await cartService.addItem(identity, signatureVariantId, 2);
    const cart = await cartService.getCart(identity);
    const service = createCheckoutService(firestore, stage6Settings);

    const first = await service.createOrder(identity, checkoutInput(cart.version!));
    const replay = await service.createOrder(identity, checkoutInput(cart.version!));
    const [orders, reservations, attempts, balance] = await Promise.all([
      firestore.collection(firestoreCollections.orders).get(),
      firestore.collection(firestoreCollections.inventoryReservations).get(),
      firestore.collection(firestoreCollections.paymentAttempts).get(),
      firestore.collection(firestoreCollections.inventoryBalances).doc(signatureVariantId).get(),
    ]);

    expect(first.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(replay.order.id).toBe(first.order.id);
    expect(first.order.totals).toMatchObject({
      subtotalKobo: 2_500_000,
      deliveryKobo: 350_000,
      grandTotalKobo: 2_850_000,
    });
    expect(orders.size).toBe(1);
    expect(reservations.size).toBe(1);
    expect(attempts.size).toBe(1);
    expect(balance.data()).toMatchObject({ reserved: 2, available: 38 });
  });

  it('rejects a price change without creating an order or stock hold', async () => {
    const firestore = getFirebaseAdminFirestore();
    const cartService = createCartService(firestore);
    const identity = await cartService.createGuestCart('7'.repeat(64));
    await cartService.addItem(identity, signatureVariantId, 1);
    const cart = await cartService.getCart(identity);
    await firestore.collection(firestoreCollections.productVariants).doc(signatureVariantId).update({
      priceKobo: 1_300_000,
      updatedAt: new Date(),
      updatedBy: 'stage6-price-test',
      version: 2,
    });

    await expect(
      createCheckoutService(firestore, stage6Settings).createOrder(identity, checkoutInput(cart.version!, 'checkout-stage6-price-001')),
    ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect((await firestore.collection(firestoreCollections.orders).get()).size).toBe(0);
    expect((await firestore.collection(firestoreCollections.inventoryBalances).doc(signatureVariantId).get()).data()).toMatchObject({ reserved: 0, available: 40 });
  });

  it('posts a verified payment and commits stock exactly once across webhook replay', async () => {
    const firestore = getFirebaseAdminFirestore();
    const cartService = createCartService(firestore);
    const identity = await cartService.createGuestCart('8'.repeat(64));
    await cartService.addItem(identity, signatureVariantId, 1);
    const cart = await cartService.getCart(identity);
    const creation = await createCheckoutService(firestore, stage6Settings).createOrder(
      identity,
      checkoutInput(cart.version!, 'checkout-stage6-payment-001'),
    );
    const attempt = creation.paymentAttempt!;
    const rawEvent = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 123456789,
        reference: attempt.providerReference,
        amount: attempt.intendedAmountKobo,
        currency: 'NGN',
        status: 'success',
      },
    });
    const provider = new StubPaystackProvider({
      providerTransactionId: '123456789',
      amountKobo: attempt.intendedAmountKobo,
      currency: 'NGN',
      status: 'success',
      paidAt: new Date('2026-08-01T12:00:00.000Z'),
      channel: 'card',
      safeMessage: 'Verification successful',
      safeResponseHashInput: 'stage6-safe-provider-projection',
    });
    const webhookService = createPaystackWebhookService(firestore, provider);

    const first = await webhookService.processSignedEvent(rawEvent);
    const replay = await webhookService.processSignedEvent(rawEvent);
    const [orderSnapshot, reservationSnapshot, paymentSnapshot, movementSnapshot, balanceSnapshot] = await Promise.all([
      firestore.collection(firestoreCollections.orders).doc(creation.order.id).get(),
      firestore.collection(firestoreCollections.inventoryReservations).doc(creation.order.reservationId).get(),
      firestore.collection(firestoreCollections.payments).get(),
      firestore.collection(firestoreCollections.inventoryMovements).where('referenceId', '==', creation.order.id).get(),
      firestore.collection(firestoreCollections.inventoryBalances).doc(signatureVariantId).get(),
    ]);

    expect(first).toMatchObject({ state: 'processed', replay: false });
    expect(replay).toMatchObject({ state: 'processed', replay: true });
    expect(orderSnapshot.data()).toMatchObject({ orderStatus: 'confirmed', paymentStatus: 'paid' });
    expect(reservationSnapshot.data()).toMatchObject({ state: 'committed' });
    expect(paymentSnapshot.size).toBe(1);
    expect(movementSnapshot.size).toBe(1);
    expect(balanceSnapshot.data()).toMatchObject({ onHand: 39, reserved: 0, available: 39 });
  });

  it('queues an amount mismatch without confirming or committing the order', async () => {
    const firestore = getFirebaseAdminFirestore();
    const cartService = createCartService(firestore);
    const identity = await cartService.createGuestCart('9'.repeat(64));
    await cartService.addItem(identity, signatureVariantId, 1);
    const cart = await cartService.getCart(identity);
    const creation = await createCheckoutService(firestore, stage6Settings).createOrder(
      identity,
      checkoutInput(cart.version!, 'checkout-stage6-mismatch-001'),
    );
    const attempt = creation.paymentAttempt!;
    const rawEvent = JSON.stringify({ event: 'charge.success', data: { id: 987654321, reference: attempt.providerReference } });
    const provider = new StubPaystackProvider({
      providerTransactionId: '987654321',
      amountKobo: attempt.intendedAmountKobo - 100,
      currency: 'NGN',
      status: 'success',
      paidAt: new Date('2026-08-01T12:00:00.000Z'),
      channel: 'card',
      safeMessage: 'Verification successful',
      safeResponseHashInput: 'stage6-mismatch-projection',
    });

    const result = await createPaystackWebhookService(firestore, provider).processSignedEvent(rawEvent);
    const [orderSnapshot, exceptionSnapshot, reservationSnapshot] = await Promise.all([
      firestore.collection(firestoreCollections.orders).doc(creation.order.id).get(),
      firestore.collection(firestoreCollections.paymentExceptions).get(),
      firestore.collection(firestoreCollections.inventoryReservations).doc(creation.order.reservationId).get(),
    ]);

    expect(result.state).toBe('exception');
    expect(exceptionSnapshot.docs[0].data()).toMatchObject({ reasonCode: 'AMOUNT_MISMATCH', state: 'open' });
    expect(orderSnapshot.data()).toMatchObject({ orderStatus: 'awaitingPayment', paymentStatus: 'pending' });
    expect(reservationSnapshot.data()).toMatchObject({ state: 'active' });
  });
  it('records Paystack initialisation failure without losing the order or reservation', async () => {
    const firestore = getFirebaseAdminFirestore();
    const cartService = createCartService(firestore);
    const identity = await cartService.createGuestCart('e'.repeat(64));
    await cartService.addItem(identity, signatureVariantId, 1);
    const cart = await cartService.getCart(identity);
    const creation = await createCheckoutService(firestore, stage6Settings).createOrder(
      identity,
      checkoutInput(cart.version!, 'checkout-stage6-provider-failure-001'),
    );
    const failingProvider: PaymentProvider = {
      async initialiseTransaction() {
        throw new Error('Simulated Paystack outage.');
      },
      async verifyTransaction() {
        throw new Error('Not used in this test.');
      },
    };

    await expect(
      createPaymentAttemptService(
        firestore,
        failingProvider,
        'https://bridgegateshop.example',
      ).initialiseAttempt(creation.paymentAttempt!.id, identity),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    const retryService = createPaymentAttemptService(
      firestore,
      failingProvider,
      'https://bridgegateshop.example',
    );
    const firstRetry = await retryService.createRetryAttempt(
      creation.order.id,
      identity,
      'paystack-stage6-retry-001',
    );
    const replayedRetry = await retryService.createRetryAttempt(
      creation.order.id,
      identity,
      'paystack-stage6-retry-001',
    );

    expect(firstRetry.replay).toBe(false);
    expect(replayedRetry.replay).toBe(true);
    expect(firstRetry.attempt.id).not.toBe(creation.paymentAttempt!.id);
    expect(replayedRetry.attempt.providerReference).toBe(
      firstRetry.attempt.providerReference,
    );
    const [attemptSnapshot, orderSnapshot, reservationSnapshot] =
      await Promise.all([
        firestore
          .collection(firestoreCollections.paymentAttempts)
          .doc(creation.paymentAttempt!.id)
          .get(),
        firestore
          .collection(firestoreCollections.orders)
          .doc(creation.order.id)
          .get(),
        firestore
          .collection(firestoreCollections.inventoryReservations)
          .doc(creation.order.reservationId)
          .get(),
      ]);

    expect(attemptSnapshot.data()).toMatchObject({
      initialisationState: 'failed',
      failureCode: 'UNEXPECTED',
    });
    expect(orderSnapshot.data()).toMatchObject({
      orderStatus: 'awaitingPayment',
      paymentStatus: 'pending',
    });
    expect(reservationSnapshot.data()).toMatchObject({ state: 'active' });
  });
  it('expires an abandoned Paystack order and restores availability atomically', async () => {
    const firestore = getFirebaseAdminFirestore();
    const cartService = createCartService(firestore);
    const identity = await cartService.createGuestCart('d'.repeat(64));
    await cartService.addItem(identity, signatureVariantId, 1);
    const cart = await cartService.getCart(identity);
    const creation = await createCheckoutService(firestore, stage6Settings).createOrder(
      identity,
      checkoutInput(cart.version!, 'checkout-stage6-expiry-001'),
    );
    await firestore
      .collection(firestoreCollections.inventoryReservations)
      .doc(creation.order.reservationId)
      .update({ expiresAt: new Date(Date.now() - 1_000) });

    const expiryResult = await createOrderReservationExpiryService(
      firestore,
    ).expireDueReservations(new Date());
    const [orderSnapshot, reservationSnapshot, balanceSnapshot] =
      await Promise.all([
        firestore
          .collection(firestoreCollections.orders)
          .doc(creation.order.id)
          .get(),
        firestore
          .collection(firestoreCollections.inventoryReservations)
          .doc(creation.order.reservationId)
          .get(),
        firestore
          .collection(firestoreCollections.inventoryBalances)
          .doc(signatureVariantId)
          .get(),
      ]);

    expect(expiryResult.expired).toBe(1);
    expect(orderSnapshot.data()).toMatchObject({
      orderStatus: 'failed',
      paymentStatus: 'failed',
    });
    expect(reservationSnapshot.data()).toMatchObject({ state: 'expired' });
    expect(balanceSnapshot.data()).toMatchObject({
      onHand: 40,
      reserved: 0,
      available: 40,
    });
  });
});

