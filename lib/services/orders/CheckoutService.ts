import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import type { ZodType } from 'zod';

import type { DomainErrorCode } from '@/lib/actions/actionResult';
import {
  getCheckoutSettings,
  type CheckoutSettings,
} from '@/lib/config/checkoutSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  productDocumentSchema,
  productVariantDocumentSchema,
} from '@/lib/schemas/catalogue';
import {
  cartDocumentSchema,
  cartItemDocumentSchema,
} from '@/lib/schemas/cart';
import {
  createCheckoutOrderInputSchema,
  type CreateCheckoutOrderInput,
} from '@/lib/schemas/checkout';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import {
  orderDocumentSchema,
  orderEventDocumentSchema,
  orderItemDocumentSchema,
  type OrderRecord,
} from '@/lib/schemas/order';
import {
  paymentAttemptDocumentSchema,
  type PaymentAttemptDocument,
} from '@/lib/schemas/payment';
import { transferInstructionDocumentSchema } from '@/lib/schemas/manualPayment';
import { calculatePodTerms } from '@/lib/utils/payments/calculatePodTerms';
import { calculateDeliveryEstimate } from '@/lib/utils/fulfilment/calculateDeliveryEstimate';
import type { CartIdentity } from '@/lib/services/carts/CartService';
import { createDeliveryDocument } from '@/lib/services/fulfilment/createDeliveryRecord';
import {
  reserveCheckoutInventoryInTransaction,
} from '@/lib/services/inventory/inventoryTransactionOperations';
import {
  createDeterministicId,
  getInitialPaymentAttemptId,
  getPaystackReference,
} from '@/lib/services/payments/paymentReferences';

export class CheckoutMutationError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly fieldName?: string,
  ) {
    super(message);
    this.name = 'CheckoutMutationError';
  }
}

function parseRecord<DocumentType>(
  snapshot: DocumentSnapshot,
  schema: ZodType<DocumentType>,
  entityLabel: string,
): DocumentType & { id: string } {
  const parsedDocument = schema.safeParse(snapshot.data());

  if (!snapshot.exists || !parsedDocument.success) {
    throw new CheckoutMutationError(
      snapshot.exists ? 'INVALID_STATE' : 'NOT_FOUND',
      snapshot.exists
        ? `${entityLabel} contains invalid stored data.`
        : `${entityLabel} was not found.`,
    );
  }

  return { id: snapshot.id, ...parsedDocument.data };
}

function safeHashEquals(leftValue: string, rightValue: string) {
  const leftBuffer = Buffer.from(leftValue, 'utf8');
  const rightBuffer = Buffer.from(rightValue, 'utf8');

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function assertIdentityOwnsCart(
  cart: ReturnType<typeof cartDocumentSchema.parse> & { id: string },
  identity: CartIdentity,
) {
  const customerMatches =
    identity.ownerUid !== null &&
    cart.ownerUid === identity.ownerUid &&
    cart.guestTokenHash === null;
  const guestMatches =
    identity.guestTokenHash !== null &&
    cart.ownerUid === null &&
    cart.guestTokenHash !== null &&
    safeHashEquals(cart.guestTokenHash, identity.guestTokenHash);

  if (!customerMatches && !guestMatches) {
    throw new CheckoutMutationError(
      'PERMISSION_DENIED',
      'The checkout cart could not be verified.',
    );
  }
}

function assertIdentityOwnsOrder(order: OrderRecord, identity: CartIdentity) {
  const customerMatches =
    identity.ownerUid !== null && order.ownerUid === identity.ownerUid;
  const guestMatches =
    identity.guestTokenHash !== null &&
    order.guestAccessTokenHash !== null &&
    safeHashEquals(order.guestAccessTokenHash, identity.guestTokenHash);

  if (!customerMatches && !guestMatches) {
    throw new CheckoutMutationError(
      'PERMISSION_DENIED',
      'The checkout replay could not be verified.',
    );
  }
}

function hashCheckoutRequest(input: CreateCheckoutOrderInput) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function getCheckoutOrderId(identity: CartIdentity, idempotencyKey: string) {
  const actorScope = identity.ownerUid ?? identity.guestTokenHash;

  if (!actorScope) {
    throw new CheckoutMutationError(
      'PERMISSION_DENIED',
      'A checkout owner is required.',
    );
  }

  return createDeterministicId(
    'order',
    `${actorScope}:createCheckoutOrder:${idempotencyKey}`,
  );
}

function createOrderReference() {
  return `BGS-${randomBytes(8).toString('hex').toUpperCase()}`;
}

function getReservationExpiry(
  paymentMethod: CreateCheckoutOrderInput['paymentMethod'],
  settings: CheckoutSettings,
  now: Timestamp,
) {
  const lifetimeMilliseconds =
    paymentMethod === 'paystack'
      ? settings.paystackReservationMinutes * 60 * 1_000
      : paymentMethod === 'manualTransfer'
        ? settings.manualTransferReservationHours * 60 * 60 * 1_000
        : settings.podReservationMinutes * 60 * 1_000;

  return Timestamp.fromMillis(now.toMillis() + lifetimeMilliseconds);
}

export type CheckoutOrderCreationResult = {
  order: OrderRecord;
  paymentAttempt: (PaymentAttemptDocument & { id: string }) | null;
  replay: boolean;
};

class FirestoreCheckoutService {
  constructor(
    private readonly firestore: Firestore,
    private readonly settings: CheckoutSettings,
  ) {}

  async createOrder(
    identity: CartIdentity,
    unparsedInput: CreateCheckoutOrderInput,
  ): Promise<CheckoutOrderCreationResult> {
    const input = createCheckoutOrderInputSchema.parse(unparsedInput);
    const methodSetting = this.settings.paymentMethods[input.paymentMethod];

    if (!methodSetting.enabled) {
      throw new CheckoutMutationError(
        'VALIDATION_FAILED',
        methodSetting.unavailableReason ?? 'The payment method is unavailable.',
        'paymentMethod',
      );
    }

    const checkoutRequestHash = hashCheckoutRequest(input);
    const orderId = getCheckoutOrderId(identity, input.idempotencyKey);
    const orderReference = this.firestore
      .collection(firestoreCollections.orders)
      .doc(orderId);

    return this.firestore.runTransaction(async (transaction) => {
      const existingOrderSnapshot = await transaction.get(orderReference);

      if (existingOrderSnapshot.exists) {
        const existingOrder = parseRecord(
          existingOrderSnapshot,
          orderDocumentSchema,
          'Order',
        );
        assertIdentityOwnsOrder(existingOrder, identity);

        if (existingOrder.checkoutRequestHash !== checkoutRequestHash) {
          throw new CheckoutMutationError(
            'CONFLICT',
            'The checkout idempotency key was reused with different details.',
          );
        }

        const paymentAttemptId =
          existingOrder.paymentSelection.payableNowKobo > 0 &&
          ['paystack', 'pod'].includes(existingOrder.paymentSelection.method)
            ? getInitialPaymentAttemptId(orderId)
            : null;
        const existingAttempt = paymentAttemptId
          ? parseRecord(
              await transaction.get(
                this.firestore
                  .collection(firestoreCollections.paymentAttempts)
                  .doc(paymentAttemptId),
              ),
              paymentAttemptDocumentSchema,
              'Payment attempt',
            )
          : null;

        return {
          order: existingOrder,
          paymentAttempt: existingAttempt,
          replay: true,
        };
      }

      const cartReference = this.firestore
        .collection(firestoreCollections.carts)
        .doc(identity.cartId);
      const [cartSnapshot, cartItemsSnapshot] = await Promise.all([
        transaction.get(cartReference),
        transaction.get(
          cartReference
            .collection(firestoreCollections.cartItems)
            .orderBy('variantId', 'asc')
            .limit(50),
        ),
      ]);
      const cart = parseRecord(cartSnapshot, cartDocumentSchema, 'Cart');
      const now = Timestamp.now();

      assertIdentityOwnsCart(cart, identity);

      if (
        cart.status !== 'active' ||
        firestoreTimestampToDate(cart.expiresAt).getTime() <= now.toMillis()
      ) {
        throw new CheckoutMutationError(
          'INVALID_STATE',
          'This cart is no longer active. Start a new cart and try again.',
        );
      }

      if (cart.version !== input.expectedCartVersion) {
        throw new CheckoutMutationError(
          'CONFLICT',
          'The cart changed before checkout. Review it and try again.',
        );
      }

      const cartItems = cartItemsSnapshot.docs.map((snapshot) =>
        parseRecord(snapshot, cartItemDocumentSchema, 'Cart item'),
      );

      if (cartItems.length === 0) {
        throw new CheckoutMutationError(
          'VALIDATION_FAILED',
          'Add at least one item before checkout.',
        );
      }

      const variantSnapshots = await transaction.getAll(
        ...cartItems.map((item) =>
          this.firestore
            .collection(firestoreCollections.productVariants)
            .doc(item.variantId),
        ),
      );
      const variants = variantSnapshots.map((snapshot) =>
        parseRecord(snapshot, productVariantDocumentSchema, 'Product variant'),
      );
      const productSnapshots = await transaction.getAll(
        ...variants.map((variant) =>
          this.firestore
            .collection(firestoreCollections.products)
            .doc(variant.productId),
        ),
      );
      const products = productSnapshots.map((snapshot) =>
        parseRecord(snapshot, productDocumentSchema, 'Product'),
      );
      const orderItems = cartItems.map((cartItem, itemIndex) => {
        const variant = variants[itemIndex];
        const product = products[itemIndex];

        if (
          variant.id !== cartItem.variantId ||
          variant.productId !== cartItem.productId ||
          product.id !== variant.productId ||
          variant.status !== 'active' ||
          product.status !== 'active'
        ) {
          throw new CheckoutMutationError(
            'INVALID_STATE',
            'A cart item is no longer available for purchase.',
          );
        }

        if (variant.priceKobo !== cartItem.lastDisplayedUnitPriceKobo) {
          throw new CheckoutMutationError(
            'PRICE_CHANGED',
            'A cart price changed. Review and accept the current price.',
          );
        }

        return orderItemDocumentSchema.parse({
          schemaVersion: 1,
          orderId,
          productId: product.id,
          variantId: variant.id,
          productSlug: product.slug,
          productName: product.name,
          variantName: variant.name,
          packageLabel: variant.packageLabel,
          sku: variant.sku,
          quantity: cartItem.requestedQuantity,
          unitPriceKobo: variant.priceKobo,
          lineTotalKobo: variant.priceKobo * cartItem.requestedQuantity,
          currency: 'NGN',
          taxTreatment: 'notConfigured',
          capturedAt: now,
        });
      });
      const subtotalKobo = orderItems.reduce(
        (total, item) => total + item.lineTotalKobo,
        0,
      );
      const zone =
        input.fulfilmentMethod === 'delivery'
          ? this.settings.deliveryZones.find(
              (candidate) => candidate.id === input.deliveryAddress.zoneId,
            ) ?? null
          : null;

      if (
        input.fulfilmentMethod === 'delivery' &&
        (!zone || !zone.active || !zone.deliveryEnabled)
      ) {
        throw new CheckoutMutationError(
          'VALIDATION_FAILED',
          'Select an available Lagos delivery zone.',
          'deliveryZoneId',
        );
      }
      if (input.fulfilmentMethod === 'pickup' && !this.settings.pickup.enabled) {
        throw new CheckoutMutationError(
          'VALIDATION_FAILED',
          'Store pickup is currently unavailable.',
          'fulfilmentMethod',
        );
      }
      const schedule =
        input.fulfilmentMethod === 'delivery' && zone
          ? {
              serviceDays: zone.serviceDays,
              cutoffLocalTime: zone.cutoffLocalTime,
              sameDayEnabled: zone.sameDayEnabled,
              minimumBusinessDays: zone.minimumBusinessDays,
              maximumBusinessDays: zone.maximumBusinessDays,
            }
          : {
              serviceDays: this.settings.pickup.serviceDays,
              cutoffLocalTime: this.settings.pickup.cutoffLocalTime,
              sameDayEnabled: this.settings.pickup.sameDayEnabled,
              minimumBusinessDays:
                this.settings.pickup.minimumPreparationBusinessDays,
              maximumBusinessDays:
                this.settings.pickup.maximumPreparationBusinessDays,
            };
      const calculatedEstimate = calculateDeliveryEstimate({
        now: now.toDate(),
        configurationVersion: this.settings.fulfilmentConfigurationVersion,
        method: input.fulfilmentMethod,
        zoneId: zone?.id ?? null,
        schedule,
        closures: this.settings.businessCalendar,
        stockImmediatelyAvailable: true,
      });
      const fulfilmentEstimate = { ...calculatedEstimate, calculatedAt: now };

      const deliveryKobo = zone?.feeKobo ?? 0;
      const grandTotalKobo = subtotalKobo + deliveryKobo;
      const podTerms =
        input.paymentMethod === 'pod'
          ? calculatePodTerms(this.settings.pod, {
              ownerUid: identity.ownerUid,
              email: input.email,
              fulfilmentMethod: input.fulfilmentMethod,
              zoneId: zone?.id ?? null,
              productIds: products.map((product) => product.id),
              variantIds: variants.map((variant) => variant.id),
              grandTotalKobo,
            })
          : null;

      if (
        input.paymentMethod === 'pod' &&
        input.fulfilmentMethod === 'delivery' &&
        !zone?.podEligible
      ) {
        throw new CheckoutMutationError(
          'VALIDATION_FAILED',
          'Pay on Delivery is unavailable for this delivery zone.',
          'paymentMethod',
        );
      }
      if (podTerms && !podTerms.eligible) {
        throw new CheckoutMutationError(
          'VALIDATION_FAILED',
          podTerms.reason,
          'paymentMethod',
        );
      }

      const depositKobo = podTerms?.eligible ? podTerms.depositKobo : 0;
      const payableNowKobo =
        input.paymentMethod === 'pod' ? depositKobo : grandTotalKobo;
      const outstandingAfterInitialPaymentKobo =
        input.paymentMethod === 'pod'
          ? grandTotalKobo - depositKobo
          : 0;
      const requiresPaystack =
        input.paymentMethod === 'paystack' ||
        (input.paymentMethod === 'pod' && depositKobo > 0);
      const paymentAttemptId = requiresPaystack
        ? getInitialPaymentAttemptId(orderId)
        : null;
      const reservationExpiry = getReservationExpiry(
        input.paymentMethod,
        this.settings,
        now,
      );
      const reservationResult = await reserveCheckoutInventoryInTransaction({
        transaction,
        firestore: this.firestore,
        unparsedInput: {
          cartId: identity.cartId,
          orderId,
          ownerUid: identity.ownerUid,
          guestTokenHash: identity.guestTokenHash,
          lines: orderItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
          paymentMethod: input.paymentMethod,
          expiresAt: reservationExpiry.toDate(),
          idempotencyKey: `checkout-reserve:${orderId}`,
        },
        actor: {
          actorId: 'system:checkout',
          requestId: input.idempotencyKey,
        },
        now,
      });
      const orderDocument = orderDocumentSchema.parse({
        schemaVersion: 1,
        reference: createOrderReference(),
        ownerUid: identity.ownerUid,
        guestAccessTokenHash: identity.guestTokenHash,
        source: 'web',
        currency: 'NGN',
        cartId: identity.cartId,
        reservationId: reservationResult.reservation.id,
        customer: {
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          company: input.company,
        },
        fulfilment:
          input.fulfilmentMethod === 'delivery'
            ? {
                method: 'delivery',
                address: {
                  recipientName: input.deliveryAddress.recipientName,
                  phone: input.deliveryAddress.phone,
                  line1: input.deliveryAddress.line1,
                  line2: input.deliveryAddress.line2,
                  landmark: input.deliveryAddress.landmark,
                  city: input.deliveryAddress.city,
                  state: input.deliveryAddress.state,
                },
                zoneId: zone?.id ?? null,
                zoneName: zone?.name ?? null,
                feeKobo: deliveryKobo,
                configurationVersion: this.settings.fulfilmentConfigurationVersion,
                estimateLabel: fulfilmentEstimate.label,
                estimate: fulfilmentEstimate,
                pickupLabel: null,
                pickupAddress: null,
                pickupOpeningHours: null,
              }
            : {
                method: 'pickup',
                address: null,
                zoneId: null,
                zoneName: null,
                feeKobo: 0,
                configurationVersion: this.settings.fulfilmentConfigurationVersion,
                estimateLabel: fulfilmentEstimate.label,
                estimate: fulfilmentEstimate,
                pickupLabel: this.settings.pickup.label,
                pickupAddress: this.settings.pickup.address,
                pickupOpeningHours: this.settings.pickup.openingHours,
              },
        totals: {
          subtotalKobo,
          discountKobo: 0,
          deliveryKobo,
          taxKobo: 0,
          grandTotalKobo,
          amountPaidKobo: 0,
          amountOutstandingKobo: grandTotalKobo,
        },
        paymentSelection: {
          method: input.paymentMethod,
          configurationVersion: this.settings.configurationVersion,
          payableNowKobo,
          depositKobo,
          outstandingAfterInitialPaymentKobo,
          podConfirmationMode:
            input.paymentMethod === 'pod'
              ? this.settings.pod.confirmationMode
              : null,
          manualTransferPartialAllowed:
            input.paymentMethod === 'manualTransfer' &&
            this.settings.manualTransfer.allowPartialPayments,
        },
        policyEvidence: {
          ...this.settings.policyEvidence,
          acceptedAt: now,
        },
        customerNote: input.customerNote,
        orderStatus:
          input.paymentMethod === 'pod' && depositKobo === 0
            ? 'pending'
            : 'awaitingPayment',
        paymentStatus: requiresPaystack ? 'pending' : 'unpaid',
        fulfilmentStatus: 'unfulfilled',
        cancellationSummary: null,
        refundTotalKobo: 0,
        refundPendingKobo: 0,
        assignedStaffUid: null,
        internalNoteCount: 0,
        checkoutIdempotencyKey: input.idempotencyKey,
        checkoutRequestHash,
        placedAt: now,
        confirmedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: now,
        createdBy: identity.ownerUid ?? 'system:guest-checkout',
        updatedAt: now,
        updatedBy: identity.ownerUid ?? 'system:guest-checkout',
        version: 1,
      });
      const deliveryDocument = createDeliveryDocument({
        orderId,
        order: orderDocument,
        settings: this.settings,
        zone,
        estimate: fulfilmentEstimate,
        now,
      });
      const paymentAttempt = paymentAttemptId
        ? paymentAttemptDocumentSchema.parse({
            schemaVersion: 1,
            orderId,
            orderReference: orderDocument.reference,
            method: 'paystack',
            provider: 'paystack',
            intendedAmountKobo: payableNowKobo,
            currency: 'NGN',
            attemptType: input.paymentMethod === 'pod' ? 'deposit' : 'full',
            idempotencyKey: `checkout-paystack:${orderId}`,
            requestHash: createHash('sha256')
              .update(`${orderId}:${payableNowKobo}:NGN`)
              .digest('hex'),
            providerReference: getPaystackReference(paymentAttemptId),
            initialisationState: 'pending',
            authorizationUrl: null,
            accessCode: null,
            redirectExpiresAt: reservationExpiry,
            providerInitialisedAt: null,
            failureCode: null,
            safeProviderMessage: null,
            createdAt: now,
            createdBy: 'system:checkout',
            updatedAt: now,
            updatedBy: 'system:checkout',
            version: 1,
          })
        : null;

      transaction.create(orderReference, orderDocument);
      transaction.create(
        this.firestore.collection(firestoreCollections.deliveries).doc(orderId),
        deliveryDocument,
      );
      for (const orderItem of orderItems) {
        transaction.create(
          orderReference
            .collection(firestoreCollections.orderItems)
            .doc(orderItem.variantId),
          orderItem,
        );
      }
      transaction.create(
        orderReference
          .collection(firestoreCollections.orderEvents)
          .doc(createDeterministicId('event', `${orderId}:placed`)),
        orderEventDocumentSchema.parse({
          schemaVersion: 1,
          orderId,
          eventType: 'order.placed',
          previousOrderStatus: null,
          nextOrderStatus: orderDocument.orderStatus,
          previousPaymentStatus: null,
          nextPaymentStatus: orderDocument.paymentStatus,
          customerLabel: 'Order placed',
          customerNote: 'Your order is awaiting verified payment.',
          actorId: 'system:checkout',
          idempotencyKey: `order-placed:${orderId}`,
          occurredAt: now,
        }),
      );
      transaction.set(
        cartReference,
        cartDocumentSchema.parse({
          ...cart,
          status: 'converted',
          updatedAt: now,
          updatedBy: identity.ownerUid ?? 'system:guest-checkout',
          version: cart.version + 1,
        }),
      );

      if (paymentAttemptId && paymentAttempt) {
        transaction.create(
          this.firestore
            .collection(firestoreCollections.paymentAttempts)
            .doc(paymentAttemptId),
          paymentAttempt,
        );
      }

      if (input.paymentMethod === 'manualTransfer') {
        transaction.create(
          this.firestore
            .collection(firestoreCollections.transferInstructions)
            .doc(orderId),
          transferInstructionDocumentSchema.parse({
            schemaVersion: 1,
            orderId,
            settingsVersion: this.settings.manualTransfer.instructionsVersion,
            ...this.settings.manualTransfer.instructions,
            createdAt: now,
          }),
        );
      }

      transaction.create(
        this.firestore.collection(firestoreCollections.outboxEvents).doc(
          createDeterministicId('outbox', `${orderId}:placed`),
        ),
        {
          schemaVersion: 1,
          eventName: 'order.placed',
          aggregateType: 'order',
          aggregateId: orderId,
          payload: {
            orderReference: orderDocument.reference,
            paymentMethod: input.paymentMethod,
            amountKobo: grandTotalKobo,
            currency: 'NGN',
          },
          state: 'pending',
          attemptCount: 0,
          nextAttemptAt: now,
          leaseExpiresAt: null,
          createdAt: now,
        },
      );

      return {
        order: { id: orderId, ...orderDocument },
        paymentAttempt: paymentAttempt
          ? { id: paymentAttemptId as string, ...paymentAttempt }
          : null,
        replay: false,
      };
    });
  }
}

export type CheckoutService = FirestoreCheckoutService;

export function createCheckoutService(
  firestore: Firestore = getFirebaseAdminFirestore(),
  settings: CheckoutSettings = getCheckoutSettings(),
): CheckoutService {
  return new FirestoreCheckoutService(firestore, settings);
}

