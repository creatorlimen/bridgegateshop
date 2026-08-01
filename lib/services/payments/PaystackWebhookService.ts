import 'server-only';

import { createHash } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import {
  orderDocumentSchema,
  orderEventDocumentSchema,
} from '@/lib/schemas/order';
import {
  paymentAttemptDocumentSchema,
  paymentDocumentSchema,
  paymentExceptionDocumentSchema,
  providerWebhookEventDocumentSchema,
} from '@/lib/schemas/payment';
import { inventoryReservationDocumentSchema } from '@/lib/schemas/inventory';
import {
  commitCheckoutInventoryInTransaction,
} from '@/lib/services/inventory/inventoryTransactionOperations';
import {
  PaystackClient,
  type PaymentProvider,
  type VerifiedPayment,
} from '@/lib/services/payments/PaystackClient';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

const maximumWebhookBodyBytes = 256 * 1_024;

const paystackWebhookSchema = z
  .object({
    event: z.string().min(1).max(120),
    data: z
      .object({
        id: z.union([z.number().int().nonnegative(), z.string().min(1).max(40)]),
        reference: z.string().min(8).max(100),
        amount: z.number().int().nonnegative().optional(),
        currency: z.string().min(3).max(8).optional(),
        status: z.string().min(1).max(40).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type PaystackWebhookProcessingResult = {
  accepted: true;
  state: 'processed' | 'ignored' | 'exception';
  replay: boolean;
  eventId: string;
};

export class PaystackWebhookError extends Error {
  constructor(
    readonly code: 'INVALID_PAYLOAD' | 'PROVIDER_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'PaystackWebhookError';
  }
}

function parseStoredDocument<DocumentType>(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  schema: z.ZodType<DocumentType>,
  label: string,
) {
  const parsedDocument = schema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedDocument.success) {
    throw new PaystackWebhookError(
      'INVALID_PAYLOAD',
      snapshot.exists ? `${label} is invalid.` : `${label} was not found.`,
    );
  }

  return { id: snapshot.id, ...parsedDocument.data };
}

function getWebhookEventId(payloadHash: string) {
  return `paystack_${payloadHash.slice(0, 64)}`;
}

function getSafeWebhookMetadata(
  event: z.infer<typeof paystackWebhookSchema>,
) {
  return {
    transactionId: String(event.data.id).slice(0, 40),
    amountKobo: event.data.amount ?? null,
    currency: event.data.currency?.slice(0, 8) ?? null,
    status: event.data.status?.slice(0, 40) ?? null,
  };
}

class FirestorePaystackWebhookService {
  constructor(
    private readonly firestore: Firestore,
    private readonly provider: PaymentProvider,
  ) {}

  async processSignedEvent(
    rawBody: string,
  ): Promise<PaystackWebhookProcessingResult> {
    if (Buffer.byteLength(rawBody, 'utf8') > maximumWebhookBodyBytes) {
      throw new PaystackWebhookError(
        'INVALID_PAYLOAD',
        'The Paystack event exceeds the accepted size.',
      );
    }

    let unparsedEvent: unknown;

    try {
      unparsedEvent = JSON.parse(rawBody);
    } catch {
      throw new PaystackWebhookError(
        'INVALID_PAYLOAD',
        'The Paystack event is not valid JSON.',
      );
    }

    const parsedEvent = paystackWebhookSchema.safeParse(unparsedEvent);

    if (!parsedEvent.success) {
      throw new PaystackWebhookError(
        'INVALID_PAYLOAD',
        'The Paystack event shape is invalid.',
      );
    }

    const event = parsedEvent.data;
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const eventId = getWebhookEventId(payloadHash);
    const eventReference = this.firestore
      .collection(firestoreCollections.providerWebhookEvents)
      .doc(eventId);
    const receiptState = await this.firestore.runTransaction(
      async (transaction) => {
        const existingSnapshot = await transaction.get(eventReference);

        if (existingSnapshot.exists) {
          const existingEvent = parseStoredDocument(
            existingSnapshot,
            providerWebhookEventDocumentSchema,
            'Paystack webhook receipt',
          );

          if (['processed', 'ignored'].includes(existingEvent.processingState)) {
            return existingEvent.processingState as 'processed' | 'ignored';
          }

          const now = Timestamp.now();
          transaction.set(
            eventReference,
            providerWebhookEventDocumentSchema.parse({
              ...existingEvent,
              processingState: 'received',
              attemptCount: Math.min(existingEvent.attemptCount + 1, 100),
              errorCode: null,
              updatedAt: now,
              updatedBy: 'system:paystack-webhook',
              version: existingEvent.version + 1,
            }),
          );
          return 'received' as const;
        }

        const now = Timestamp.now();
        transaction.create(
          eventReference,
          providerWebhookEventDocumentSchema.parse({
            schemaVersion: 1,
            provider: 'paystack',
            eventType: event.event,
            providerReference: event.data.reference,
            signatureVerified: true,
            payloadHash,
            processingState: 'received',
            attemptCount: 1,
            paymentAttemptId: null,
            orderId: null,
            errorCode: null,
            safeMetadata: getSafeWebhookMetadata(event),
            receivedAt: now,
            processedAt: null,
            createdAt: now,
            createdBy: 'system:paystack-webhook',
            updatedAt: now,
            updatedBy: 'system:paystack-webhook',
            version: 1,
          }),
        );
        return 'received' as const;
      },
    );

    if (receiptState === 'processed' || receiptState === 'ignored') {
      return { accepted: true, state: receiptState, replay: true, eventId };
    }

    if (event.event !== 'charge.success') {
      await this.finishReceipt(eventReference, 'ignored');
      return { accepted: true, state: 'ignored', replay: false, eventId };
    }

    let verifiedPayment: VerifiedPayment;

    try {
      verifiedPayment = await this.provider.verifyTransaction(event.data.reference);
    } catch {
      await this.recordException({
        eventId,
        providerReference: event.data.reference,
        reasonCode: 'PROVIDER_VERIFICATION_FAILED',
        expectedAmountKobo: null,
        receivedAmountKobo: event.data.amount ?? null,
        paymentAttemptId: null,
        orderId: null,
      });
      return { accepted: true, state: 'exception', replay: false, eventId };
    }

    const attemptSnapshot = await this.firestore
      .collection(firestoreCollections.paymentAttempts)
      .where('providerReference', '==', event.data.reference)
      .limit(2)
      .get();

    if (attemptSnapshot.size !== 1) {
      await this.recordException({
        eventId,
        providerReference: event.data.reference,
        reasonCode: 'UNKNOWN_REFERENCE',
        expectedAmountKobo: null,
        receivedAmountKobo: verifiedPayment.amountKobo,
        paymentAttemptId: null,
        orderId: null,
      });
      return { accepted: true, state: 'exception', replay: false, eventId };
    }

    const attempt = parseStoredDocument(
      attemptSnapshot.docs[0],
      paymentAttemptDocumentSchema,
      'Payment attempt',
    );
    const mismatchReason =
      verifiedPayment.providerReference !== attempt.providerReference
        ? 'REFERENCE_MISMATCH'
        : verifiedPayment.amountKobo !== attempt.intendedAmountKobo
          ? 'AMOUNT_MISMATCH'
          : verifiedPayment.currency !== attempt.currency
            ? 'CURRENCY_MISMATCH'
            : verifiedPayment.status !== 'success'
              ? 'PROVIDER_VERIFICATION_FAILED'
              : null;

    if (mismatchReason) {
      await this.recordException({
        eventId,
        providerReference: event.data.reference,
        reasonCode: mismatchReason,
        expectedAmountKobo: attempt.intendedAmountKobo,
        receivedAmountKobo: verifiedPayment.amountKobo,
        paymentAttemptId: attempt.id,
        orderId: attempt.orderId,
      });
      return { accepted: true, state: 'exception', replay: false, eventId };
    }

    return this.postVerifiedPayment({
      eventId,
      attemptId: attempt.id,
      verifiedPayment,
    });
  }

  private async finishReceipt(
    eventReference: FirebaseFirestore.DocumentReference,
    state: 'processed' | 'ignored',
  ) {
    await this.firestore.runTransaction(async (transaction) => {
      const currentEvent = parseStoredDocument(
        await transaction.get(eventReference),
        providerWebhookEventDocumentSchema,
        'Paystack webhook receipt',
      );
      const now = Timestamp.now();

      transaction.set(
        eventReference,
        providerWebhookEventDocumentSchema.parse({
          ...currentEvent,
          processingState: state,
          processedAt: now,
          updatedAt: now,
          updatedBy: 'system:paystack-webhook',
          version: currentEvent.version + 1,
        }),
      );
    });
  }

  private async recordException(input: {
    eventId: string;
    providerReference: string;
    reasonCode:
      | 'UNKNOWN_REFERENCE'
      | 'AMOUNT_MISMATCH'
      | 'CURRENCY_MISMATCH'
      | 'REFERENCE_MISMATCH'
      | 'RESERVATION_EXPIRED'
      | 'ORDER_STATE_MISMATCH'
      | 'PROVIDER_VERIFICATION_FAILED';
    expectedAmountKobo: number | null;
    receivedAmountKobo: number | null;
    paymentAttemptId: string | null;
    orderId: string | null;
  }) {
    const eventReference = this.firestore
      .collection(firestoreCollections.providerWebhookEvents)
      .doc(input.eventId);
    const exceptionReference = this.firestore
      .collection(firestoreCollections.paymentExceptions)
      .doc(createDeterministicId('exception', `${input.eventId}:${input.reasonCode}`));

    await this.firestore.runTransaction(async (transaction) => {
      const [eventSnapshot, exceptionSnapshot] = await transaction.getAll(
        eventReference,
        exceptionReference,
      );
      const currentEvent = parseStoredDocument(
        eventSnapshot,
        providerWebhookEventDocumentSchema,
        'Paystack webhook receipt',
      );
      const now = Timestamp.now();

      if (!exceptionSnapshot.exists) {
        transaction.create(
          exceptionReference,
          paymentExceptionDocumentSchema.parse({
            schemaVersion: 1,
            provider: 'paystack',
            providerReference: input.providerReference,
            orderId: input.orderId,
            paymentAttemptId: input.paymentAttemptId,
            webhookEventId: input.eventId,
            reasonCode: input.reasonCode,
            expectedAmountKobo: input.expectedAmountKobo,
            receivedAmountKobo: input.receivedAmountKobo,
            state: 'open',
            resolution: null,
            createdAt: now,
            createdBy: 'system:paystack-webhook',
            updatedAt: now,
            updatedBy: 'system:paystack-webhook',
            version: 1,
          }),
        );
      }

      transaction.set(
        eventReference,
        providerWebhookEventDocumentSchema.parse({
          ...currentEvent,
          processingState: 'exception',
          paymentAttemptId: input.paymentAttemptId,
          orderId: input.orderId,
          errorCode: input.reasonCode,
          processedAt: now,
          updatedAt: now,
          updatedBy: 'system:paystack-webhook',
          version: currentEvent.version + 1,
        }),
      );
    });
  }

  private async postVerifiedPayment({
    eventId,
    attemptId,
    verifiedPayment,
  }: {
    eventId: string;
    attemptId: string;
    verifiedPayment: VerifiedPayment;
  }): Promise<PaystackWebhookProcessingResult> {
    const eventReference = this.firestore
      .collection(firestoreCollections.providerWebhookEvents)
      .doc(eventId);
    const attemptReference = this.firestore
      .collection(firestoreCollections.paymentAttempts)
      .doc(attemptId);
    const paymentId = createDeterministicId(
      'payment',
      `paystack:${verifiedPayment.providerReference}`,
    );
    const paymentReference = this.firestore
      .collection(firestoreCollections.payments)
      .doc(paymentId);

    try {
      const transactionResult = await this.firestore.runTransaction(
        async (transaction) => {
          const [eventSnapshot, attemptSnapshot, paymentSnapshot] =
            await transaction.getAll(
              eventReference,
              attemptReference,
              paymentReference,
            );
          const currentEvent = parseStoredDocument(
            eventSnapshot,
            providerWebhookEventDocumentSchema,
            'Paystack webhook receipt',
          );
          const attempt = parseStoredDocument(
            attemptSnapshot,
            paymentAttemptDocumentSchema,
            'Payment attempt',
          );
          const orderReference = this.firestore
            .collection(firestoreCollections.orders)
            .doc(attempt.orderId);
          const orderSnapshot = await transaction.get(orderReference);
          const order = parseStoredDocument(
            orderSnapshot,
            orderDocumentSchema,
            'Order',
          );
          const reservationReference = this.firestore
            .collection(firestoreCollections.inventoryReservations)
            .doc(order.reservationId);
          const reservation = parseStoredDocument(
            await transaction.get(reservationReference),
            inventoryReservationDocumentSchema,
            'Inventory reservation',
          );

          if (paymentSnapshot.exists) {
            const now = Timestamp.now();
            transaction.set(
              eventReference,
              providerWebhookEventDocumentSchema.parse({
                ...currentEvent,
                processingState: 'processed',
                paymentAttemptId: attempt.id,
                orderId: order.id,
                errorCode: null,
                processedAt: now,
                updatedAt: now,
                updatedBy: 'system:paystack-webhook',
                version: currentEvent.version + 1,
              }),
            );
            return { replay: true };
          }

          const reservationExpired =
            reservation.state !== 'active' ||
            firestoreTimestampToDate(reservation.expiresAt).getTime() <= Date.now();

          if (reservationExpired) {
            throw new Error('RESERVATION_EXPIRED');
          }

          if (
            order.orderStatus !== 'awaitingPayment' ||
            !['pending', 'unpaid', 'failed'].includes(order.paymentStatus) ||
            order.totals.amountPaidKobo !== 0
          ) {
            throw new Error('ORDER_STATE_MISMATCH');
          }

          const now = Timestamp.now();
          await commitCheckoutInventoryInTransaction({
            transaction,
            firestore: this.firestore,
            reservationId: order.reservationId,
            idempotencyKey: `payment-commit:${paymentId}`,
            reason: `Verified Paystack payment ${verifiedPayment.providerReference}.`,
            actor: {
              actorId: 'system:paystack-webhook',
              requestId: eventId,
            },
            now,
          });
          const safeResponseHash = createHash('sha256')
            .update(verifiedPayment.safeResponseHashInput)
            .digest('hex');
          const nextOrder = orderDocumentSchema.parse({
            ...order,
            totals: {
              ...order.totals,
              amountPaidKobo: verifiedPayment.amountKobo,
              amountOutstandingKobo: 0,
            },
            orderStatus: 'confirmed',
            paymentStatus: 'paid',
            confirmedAt: now,
            updatedAt: now,
            updatedBy: 'system:paystack-webhook',
            version: order.version + 1,
          });

          transaction.create(
            paymentReference,
            paymentDocumentSchema.parse({
              schemaVersion: 1,
              orderId: order.id,
              paymentAttemptId: attempt.id,
              method: 'paystack',
              provider: 'paystack',
              providerReference: verifiedPayment.providerReference,
              amountKobo: verifiedPayment.amountKobo,
              currency: 'NGN',
              state: 'succeeded',
              providerPaidAt: verifiedPayment.paidAt
                ? Timestamp.fromDate(verifiedPayment.paidAt)
                : null,
              verifiedAt: now,
              verificationSource: 'webhook',
              safeResponseHash,
              channel: verifiedPayment.channel,
              providerTransactionId: verifiedPayment.providerTransactionId,
              deduplicationKey: `paystack:${verifiedPayment.providerReference}`,
              createdAt: now,
            }),
          );
          transaction.set(orderReference, orderDocumentSchema.parse(nextOrder));
          transaction.create(
            orderReference
              .collection(firestoreCollections.orderEvents)
              .doc(createDeterministicId('event', `${paymentId}:confirmed`)),
            orderEventDocumentSchema.parse({
              schemaVersion: 1,
              orderId: order.id,
              eventType: 'payment.confirmed',
              previousOrderStatus: order.orderStatus,
              nextOrderStatus: 'confirmed',
              previousPaymentStatus: order.paymentStatus,
              nextPaymentStatus: 'paid',
              customerLabel: 'Payment confirmed',
              customerNote: 'Payment was verified and your order is confirmed.',
              actorId: 'system:paystack-webhook',
              idempotencyKey: `payment-confirmed:${paymentId}`,
              occurredAt: now,
            }),
          );
          transaction.set(
            eventReference,
            providerWebhookEventDocumentSchema.parse({
              ...currentEvent,
              processingState: 'processed',
              paymentAttemptId: attempt.id,
              orderId: order.id,
              errorCode: null,
              processedAt: now,
              updatedAt: now,
              updatedBy: 'system:paystack-webhook',
              version: currentEvent.version + 1,
            }),
          );
          transaction.create(
            this.firestore.collection(firestoreCollections.outboxEvents).doc(
              createDeterministicId('outbox', `${paymentId}:confirmed`),
            ),
            {
              schemaVersion: 1,
              eventName: 'payment.confirmed',
              aggregateType: 'payment',
              aggregateId: paymentId,
              payload: {
                orderId: order.id,
                orderReference: order.reference,
                amountKobo: verifiedPayment.amountKobo,
                currency: 'NGN',
              },
              state: 'pending',
              attemptCount: 0,
              nextAttemptAt: now,
              leaseExpiresAt: null,
              createdAt: now,
            },
          );

          return { replay: false };
        },
      );

      return {
        accepted: true,
        state: 'processed',
        replay: transactionResult.replay,
        eventId,
      };
    } catch (error) {
      const reasonCode =
        error instanceof Error && error.message === 'RESERVATION_EXPIRED'
          ? 'RESERVATION_EXPIRED'
          : error instanceof Error && error.message === 'ORDER_STATE_MISMATCH'
            ? 'ORDER_STATE_MISMATCH'
            : null;

      if (!reasonCode) {
        throw error;
      }

      const attemptSnapshot = await attemptReference.get();
      const attempt = parseStoredDocument(
        attemptSnapshot,
        paymentAttemptDocumentSchema,
        'Payment attempt',
      );
      await this.recordException({
        eventId,
        providerReference: verifiedPayment.providerReference,
        reasonCode,
        expectedAmountKobo: attempt.intendedAmountKobo,
        receivedAmountKobo: verifiedPayment.amountKobo,
        paymentAttemptId: attempt.id,
        orderId: attempt.orderId,
      });
      return { accepted: true, state: 'exception', replay: false, eventId };
    }
  }
}

export function createPaystackWebhookService(
  firestore: Firestore = getFirebaseAdminFirestore(),
  provider: PaymentProvider = new PaystackClient(),
) {
  return new FirestorePaystackWebhookService(firestore, provider);
}

