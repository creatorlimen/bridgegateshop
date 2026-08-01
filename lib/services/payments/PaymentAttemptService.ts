import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { DomainErrorCode } from '@/lib/actions/actionResult';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { orderDocumentSchema, orderEventDocumentSchema, type OrderRecord } from '@/lib/schemas/order';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import { inventoryReservationDocumentSchema } from '@/lib/schemas/inventory';
import {
  paymentAttemptDocumentSchema,
  type PaymentAttemptDocument,
} from '@/lib/schemas/payment';
import type { CartIdentity } from '@/lib/services/carts/CartService';
import {
  PaystackClient,
  PaystackProviderError,
  type PaymentProvider,
} from '@/lib/services/payments/PaystackClient';
import { createDeterministicId, getPaystackReference } from '@/lib/services/payments/paymentReferences';

export class PaymentAttemptError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'PaymentAttemptError';
  }
}

function parseOrder(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsedOrder = orderDocumentSchema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedOrder.success) {
    throw new PaymentAttemptError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists ? 'Order data is invalid.' : 'Order was not found.',
    );
  }

  return { id: snapshot.id, ...parsedOrder.data };
}

function parseAttempt(snapshot: FirebaseFirestore.DocumentSnapshot) {
  const parsedAttempt = paymentAttemptDocumentSchema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedAttempt.success) {
    throw new PaymentAttemptError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists
        ? 'Payment attempt data is invalid.'
        : 'Payment attempt was not found.',
    );
  }

  return { id: snapshot.id, ...parsedAttempt.data };
}

function safeHashEquals(leftValue: string, rightValue: string) {
  const leftBuffer = Buffer.from(leftValue, 'utf8');
  const rightBuffer = Buffer.from(rightValue, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertOrderOwner(order: OrderRecord, identity: CartIdentity) {
  const customerMatches = identity.ownerUid !== null && order.ownerUid === identity.ownerUid;
  const guestMatches =
    identity.guestTokenHash !== null &&
    order.guestAccessTokenHash !== null &&
    safeHashEquals(identity.guestTokenHash, order.guestAccessTokenHash);

  if (!customerMatches && !guestMatches) {
    throw new PaymentAttemptError('PERMISSION_DENIED', 'The order could not be verified.');
  }
}

class FirestorePaymentAttemptService {
  constructor(
    private readonly firestore: Firestore,
    private readonly provider: PaymentProvider,
    private readonly appBaseUrl: string,
  ) {}

  async createRetryAttempt(
    orderId: string,
    identity: CartIdentity,
    idempotencyKey: string,
  ) {
    if (
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 160 ||
      !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
    ) {
      throw new PaymentAttemptError(
        'VALIDATION_FAILED',
        'A valid payment retry idempotency key is required.',
      );
    }

    const attemptId = createDeterministicId(
      'attempt',
      `${orderId}:paystack:retry:${idempotencyKey}`,
    );
    const attemptReference = this.firestore
      .collection(firestoreCollections.paymentAttempts)
      .doc(attemptId);
    const orderReference = this.firestore
      .collection(firestoreCollections.orders)
      .doc(orderId);

    return this.firestore.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderReference);
      const order = parseOrder(orderSnapshot);
      assertOrderOwner(order, identity);
      const reservationReference = this.firestore
        .collection(firestoreCollections.inventoryReservations)
        .doc(order.reservationId);
      const [reservationSnapshot, existingAttemptSnapshot] =
        await transaction.getAll(reservationReference, attemptReference);

      if (existingAttemptSnapshot.exists) {
        const existingAttempt = parseAttempt(existingAttemptSnapshot);
        if (
          existingAttempt.orderId !== orderId ||
          existingAttempt.idempotencyKey !== idempotencyKey
        ) {
          throw new PaymentAttemptError(
            'CONFLICT',
            'The retry idempotency key was reused with different data.',
          );
        }
        return { attempt: existingAttempt, replay: true };
      }

      const reservationParse = inventoryReservationDocumentSchema.safeParse(
        reservationSnapshot.data(),
      );
      if (!reservationSnapshot.exists || !reservationParse.success) {
        throw new PaymentAttemptError(
          'INVALID_STATE',
          'The order reservation is invalid.',
        );
      }

      if (
        order.orderStatus !== 'awaitingPayment' ||
        !(
          order.paymentSelection.method === 'paystack' ||
          (order.paymentSelection.method === 'pod' && order.paymentSelection.depositKobo > 0)
        ) ||
        reservationParse.data.state !== 'active' ||
        firestoreTimestampToDate(reservationParse.data.expiresAt).getTime() <=
          Date.now()
      ) {
        throw new PaymentAttemptError(
          'INVALID_STATE',
          'The payment window has expired or the order is no longer retryable.',
        );
      }

      const now = Timestamp.now();
      const attemptDocument = paymentAttemptDocumentSchema.parse({
        schemaVersion: 1,
        orderId,
        orderReference: order.reference,
        method: 'paystack',
        provider: 'paystack',
        intendedAmountKobo: order.paymentSelection.payableNowKobo,
        currency: 'NGN',
        attemptType: order.paymentSelection.method === 'pod' ? 'deposit' : 'full',
        idempotencyKey,
        requestHash: createHash('sha256')
          .update(`${orderId}:${idempotencyKey}:${order.paymentSelection.payableNowKobo}`)
          .digest('hex'),
        providerReference: getPaystackReference(attemptId),
        initialisationState: 'pending',
        authorizationUrl: null,
        accessCode: null,
        redirectExpiresAt: reservationParse.data.expiresAt,
        providerInitialisedAt: null,
        failureCode: null,
        safeProviderMessage: null,
        createdAt: now,
        createdBy: identity.ownerUid ?? 'system:guest-checkout',
        updatedAt: now,
        updatedBy: identity.ownerUid ?? 'system:guest-checkout',
        version: 1,
      });

      transaction.create(attemptReference, attemptDocument);
      return {
        attempt: { id: attemptId, ...attemptDocument },
        replay: false,
      };
    });
  }

  async initialiseAttempt(
    attemptId: string,
    identity: CartIdentity,
  ): Promise<{ authorizationUrl: string; replay: boolean }> {
    const attemptReference = this.firestore
      .collection(firestoreCollections.paymentAttempts)
      .doc(attemptId);
    const initialAttempt = parseAttempt(await attemptReference.get());
    const orderReference = this.firestore
      .collection(firestoreCollections.orders)
      .doc(initialAttempt.orderId);
    const initialOrder = parseOrder(await orderReference.get());
    assertOrderOwner(initialOrder, identity);

    if (
      initialOrder.orderStatus !== 'awaitingPayment' ||
      !(
        initialOrder.paymentSelection.method === 'paystack' ||
        (initialOrder.paymentSelection.method === 'pod' && initialOrder.paymentSelection.depositKobo > 0)
      )
    ) {
      throw new PaymentAttemptError(
        'INVALID_STATE',
        'This order is not eligible for Paystack initialisation.',
      );
    }

    if (
      initialAttempt.initialisationState === 'initialised' &&
      initialAttempt.authorizationUrl
    ) {
      return { authorizationUrl: initialAttempt.authorizationUrl, replay: true };
    }

    if (initialAttempt.initialisationState !== 'pending') {
      throw new PaymentAttemptError(
        'INVALID_STATE',
        'This payment attempt cannot be initialised again.',
      );
    }

    let redirect;

    try {
      redirect = await this.provider.initialiseTransaction({
        email: initialOrder.customer.email,
        amountKobo: initialAttempt.intendedAmountKobo,
        currency: 'NGN',
        reference: initialAttempt.providerReference,
        callbackUrl: `${this.appBaseUrl.replace(/\/$/, '')}/checkout/complete`,
        orderId: initialOrder.id,
        orderReference: initialOrder.reference,
      });
    } catch (error) {
      const now = Timestamp.now();
      await this.firestore.runTransaction(async (transaction) => {
        const currentAttempt = parseAttempt(await transaction.get(attemptReference));

        if (currentAttempt.initialisationState !== 'pending') {
          return;
        }

        const nextAttempt: PaymentAttemptDocument = paymentAttemptDocumentSchema.parse({
          ...currentAttempt,
          initialisationState: 'failed',
          failureCode:
            error instanceof PaystackProviderError ? error.code : 'UNEXPECTED',
          safeProviderMessage:
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'Paystack initialisation failed.',
          updatedAt: now,
          updatedBy: 'system:paystack-initialise',
          version: currentAttempt.version + 1,
        });
        transaction.set(attemptReference, nextAttempt);
      });

      throw new PaymentAttemptError(
        'PROVIDER_UNAVAILABLE',
        error instanceof Error
          ? error.message
          : 'Paystack could not initialise the payment.',
      );
    }

    return this.firestore.runTransaction(async (transaction) => {
      const [attemptSnapshot, orderSnapshot] = await transaction.getAll(
        attemptReference,
        orderReference,
      );
      const currentAttempt = parseAttempt(attemptSnapshot);
      const currentOrder = parseOrder(orderSnapshot);

      if (
        currentAttempt.initialisationState === 'initialised' &&
        currentAttempt.authorizationUrl
      ) {
        return { authorizationUrl: currentAttempt.authorizationUrl, replay: true };
      }

      if (currentAttempt.initialisationState !== 'pending') {
        throw new PaymentAttemptError(
          'CONFLICT',
          'The payment attempt changed while Paystack was initialising.',
        );
      }

      const now = Timestamp.now();
      transaction.set(
        attemptReference,
        paymentAttemptDocumentSchema.parse({
          ...currentAttempt,
          initialisationState: 'initialised',
          authorizationUrl: redirect.authorizationUrl,
          accessCode: redirect.accessCode,
          providerInitialisedAt: now,
          failureCode: null,
          safeProviderMessage: redirect.safeMessage,
          updatedAt: now,
          updatedBy: 'system:paystack-initialise',
          version: currentAttempt.version + 1,
        }),
      );
      transaction.create(
        orderReference
          .collection(firestoreCollections.orderEvents)
          .doc(createDeterministicId('event', `${currentAttempt.id}:initialised`)),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId: currentOrder.id,
          eventType: 'payment.initialised',
          previousOrderStatus: currentOrder.orderStatus,
          nextOrderStatus: currentOrder.orderStatus,
          previousPaymentStatus: currentOrder.paymentStatus,
          nextPaymentStatus: currentOrder.paymentStatus,
          customerLabel: 'Online payment opened',
          customerNote: 'Complete payment with Paystack before the stock hold expires.',
          actorId: 'system:paystack-initialise',
          idempotencyKey: `payment-initialised:${currentAttempt.id}`,
          occurredAt: now,
        }),
      );

      return { authorizationUrl: redirect.authorizationUrl, replay: false };
    });
  }
}

export function createPaymentAttemptService(
  firestore: Firestore = getFirebaseAdminFirestore(),
  provider: PaymentProvider = new PaystackClient(),
  appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000',
) {
  return new FirestorePaymentAttemptService(firestore, provider, appBaseUrl);
}

