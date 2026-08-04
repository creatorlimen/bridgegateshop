import 'server-only';

import { createHash } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { NotificationRuntimeSettings } from '@/lib/config/notificationSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import { deliveryEventDocumentSchema } from '@/lib/schemas/fulfilment';
import {
  notificationAttemptDocumentSchema,
  notificationEventDocumentSchema,
  notificationTemplateDocumentSchema,
} from '@/lib/schemas/notification';
import { orderDocumentSchema } from '@/lib/schemas/order';
import {
  getFallbackFulfilmentTemplate,
  renderNotificationTemplate,
} from '@/lib/services/notifications/fulfilmentTemplates';
import {
  NotificationProviderError,
  type NotificationProvider,
} from '@/lib/services/notifications/NotificationProvider';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

type NotificationChannel = 'email' | 'sms';
type NotifiableStatus =
  | 'preparing'
  | 'readyForPickup'
  | 'dispatched'
  | 'outForDelivery'
  | 'delivered'
  | 'collected';

type ProviderSet = {
  email: NotificationProvider;
  sms: NotificationProvider;
};

export type NotificationDeliveryResult = {
  channel: NotificationChannel;
  state: 'sent' | 'suppressed' | 'failed';
  terminal: boolean;
  replay: boolean;
};

const statusLabels: Record<NotifiableStatus, string> = {
  preparing: 'Being Prepared',
  readyForPickup: 'Ready for Pickup',
  dispatched: 'Dispatched',
  outForDelivery: 'Out for Delivery',
  delivered: 'Delivered',
  collected: 'Collected',
};

function safeFailure(error: unknown) {
  return error instanceof NotificationProviderError
    ? { code: error.safeCode, message: error.message }
    : { code: 'UNAVAILABLE', message: 'Notification provider is unavailable.' };
}

function destinationHash(destination: string) {
  return createHash('sha256').update(destination.trim().toLowerCase()).digest('hex');
}

function retryDate(now: Date, attemptNumber: number) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attemptNumber - 1));
  return new Date(now.getTime() + delayMinutes * 60_000);
}

class FirestoreNotificationService {
  constructor(
    private readonly firestore: Firestore,
    private readonly settings: NotificationRuntimeSettings,
    private readonly providers: ProviderSet,
    private readonly baseUrl: string,
  ) {}

  async processDeliveryEvent(deliveryId: string, deliveryEventId: string) {
    const deliveryEventReference = this.firestore
      .collection(firestoreCollections.deliveries)
      .doc(deliveryId)
      .collection(firestoreCollections.deliveryEvents)
      .doc(deliveryEventId);
    const eventSnapshot = await deliveryEventReference.get();
    const eventParse = deliveryEventDocumentSchema.safeParse(eventSnapshot.data());
    if (!eventSnapshot.exists || !eventParse.success) {
      throw new Error('Delivery event data is invalid.');
    }
    const event = eventParse.data;
    if (!Object.hasOwn(statusLabels, event.nextStatus)) {
      return [] as NotificationDeliveryResult[];
    }
    const status = event.nextStatus as NotifiableStatus;
    const orderSnapshot = await this.firestore
      .collection(firestoreCollections.orders)
      .doc(event.orderId)
      .get();
    const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());
    if (!orderSnapshot.exists || !orderParse.success) {
      throw new Error('Notification order data is invalid.');
    }
    const order = { id: orderSnapshot.id, ...orderParse.data };
    const channels: NotificationChannel[] = ['email'];
    if (
      this.settings.sms.enabled &&
      this.settings.sms.enabledStatuses.includes(status)
    ) {
      channels.push('sms');
    }
    return Promise.all(
      channels.map((channel) =>
        this.processChannel({
          channel,
          deliveryId,
          deliveryEventId,
          status,
          order,
        }),
      ),
    );
  }

  private async loadTemplate(status: NotifiableStatus, channel: NotificationChannel) {
    const templateId = `fulfilment-${status}-${channel}`;
    const snapshot = await this.firestore
      .collection(firestoreCollections.notificationTemplates)
      .doc(templateId)
      .get();
    if (!snapshot.exists) return getFallbackFulfilmentTemplate(status, channel);
    const parsed = notificationTemplateDocumentSchema.safeParse(snapshot.data());
    if (
      !parsed.success ||
      !parsed.data.active ||
      parsed.data.fulfilmentStatus !== status ||
      parsed.data.channel !== channel
    ) {
      throw new Error('Notification template data is invalid or inactive.');
    }
    return { id: snapshot.id, ...parsed.data };
  }

  private async processChannel(input: {
    channel: NotificationChannel;
    deliveryId: string;
    deliveryEventId: string;
    status: NotifiableStatus;
    order: { id: string } & ReturnType<typeof orderDocumentSchema.parse>;
  }): Promise<NotificationDeliveryResult> {
    const template = await this.loadTemplate(input.status, input.channel);
    const destination =
      input.channel === 'email'
        ? input.order.customer.email.toLowerCase()
        : input.order.customer.phone;
    const destinationReference =
      input.channel === 'email'
        ? ('order.customer.email' as const)
        : ('order.customer.phone' as const);
    const hash = destinationHash(destination);
    const rendered = renderNotificationTemplate(template, {
      customerName: input.order.customer.fullName,
      orderReference: input.order.reference,
      statusLabel: statusLabels[input.status],
      trackingUrl: `${this.baseUrl}/track-order?reference=${encodeURIComponent(input.order.reference)}`,
    });
    const notificationEventId = createDeterministicId(
      'notification',
      `${input.deliveryEventId}:${input.channel}`,
    );
    const notificationReference = this.firestore
      .collection(firestoreCollections.notificationEvents)
      .doc(notificationEventId);
    const channelEnabled =
      input.channel === 'email'
        ? this.settings.email.enabled
        : this.settings.sms.enabled;
    const maximumAttempts =
      input.channel === 'email'
        ? this.settings.email.maximumAttempts
        : this.settings.sms.maximumAttempts;
    const claim = await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(notificationReference);
      const existing = snapshot.exists
        ? notificationEventDocumentSchema.safeParse(snapshot.data())
        : null;
      if (existing && !existing.success) {
        throw new Error('Stored notification-event data is invalid.');
      }
      if (
        existing?.success &&
        ['sent', 'suppressed'].includes(existing.data.state)
      ) {
        return { send: false, replay: true, state: existing.data.state, attemptNumber: existing.data.attemptCount };
      }
      const now = Timestamp.now();
      if (
        existing?.success &&
        existing.data.state === 'processing' &&
        existing.data.leaseExpiresAt &&
        firestoreTimestampToDate(existing.data.leaseExpiresAt).getTime() > Date.now()
      ) {
        return { send: false, replay: true, state: 'failed' as const, attemptNumber: existing.data.attemptCount };
      }
      const attemptNumber = (existing?.success ? existing.data.attemptCount : 0) + 1;
      const baseDocument = {
        schemaVersion: 1,
        businessEvent: 'fulfilment.updated' as const,
        deliveryEventId: input.deliveryEventId,
        deliveryId: input.deliveryId,
        orderId: input.order.id,
        orderReference: input.order.reference,
        channel: input.channel,
        templateId: template.id,
        templateVersion: template.templateVersion,
        destinationHash: hash,
        destinationReference,
        classification: 'transactional' as const,
        deduplicationKey: `${input.deliveryEventId}:${input.channel}`,
        attemptCount: attemptNumber,
        nextAttemptAt: now,
        renderedSubject: rendered.subject,
        renderedBody: rendered.body,
        createdAt: existing?.success ? existing.data.createdAt : now,
        createdBy: existing?.success ? existing.data.createdBy : 'system:outbox',
        updatedAt: now,
        updatedBy: 'system:outbox',
        version: existing?.success ? existing.data.version + 1 : 1,
      };
      if (!channelEnabled || attemptNumber > maximumAttempts) {
        const state = !channelEnabled ? 'suppressed' : 'failed';
        transaction.set(
          notificationReference,
          notificationEventDocumentSchema.parse({
            ...baseDocument,
            state,
            leaseExpiresAt: null,
            lastSafeError: !channelEnabled
              ? `${input.channel.toUpperCase()}_DISABLED`
              : 'MAXIMUM_ATTEMPTS_REACHED',
            sentAt: null,
          }),
        );
        const attemptReference = this.firestore
          .collection(firestoreCollections.notificationAttempts)
          .doc(createDeterministicId('notification-attempt', `${notificationEventId}:${attemptNumber}`));
        transaction.create(
          attemptReference,
          notificationAttemptDocumentSchema.parse({
            schemaVersion: 1,
            notificationEventId,
            channel: input.channel,
            destinationHash: hash,
            destinationReference,
            provider: this.providers[input.channel].name,
            providerMessageId: null,
            state: !channelEnabled ? 'suppressed' : 'failed',
            attemptNumber,
            safeFailureCode: !channelEnabled
              ? `${input.channel.toUpperCase()}_DISABLED`
              : 'MAXIMUM_ATTEMPTS_REACHED',
            createdAt: now,
            completedAt: now,
          }),
        );
        return { send: false, replay: false, state, attemptNumber };
      }
      transaction.set(
        notificationReference,
        notificationEventDocumentSchema.parse({
          ...baseDocument,
          state: 'processing',
          leaseExpiresAt: Timestamp.fromMillis(now.toMillis() + 60_000),
          lastSafeError: null,
          sentAt: null,
        }),
      );
      return { send: true, replay: false, state: 'processing' as const, attemptNumber };
    });
    if (!claim.send) {
      return {
        channel: input.channel,
        state:
          claim.state === 'sent'
            ? 'sent'
            : claim.state === 'suppressed'
              ? 'suppressed'
              : 'failed',
        terminal: claim.state === 'sent' || claim.state === 'suppressed',
        replay: claim.replay,
      };
    }

    const attemptReference = this.firestore
      .collection(firestoreCollections.notificationAttempts)
      .doc(
        createDeterministicId(
          'notification-attempt',
          `${notificationEventId}:${claim.attemptNumber}`,
        ),
      );
    try {
      const result = await this.providers[input.channel].send({
        destination,
        subject: rendered.subject,
        body: rendered.body,
        idempotencyKey: `${input.deliveryEventId}:${input.channel}`,
      });
      await this.firestore.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(notificationReference);
        const current = notificationEventDocumentSchema.parse(currentSnapshot.data());
        const now = Timestamp.now();
        transaction.create(
          attemptReference,
          notificationAttemptDocumentSchema.parse({
            schemaVersion: 1,
            notificationEventId,
            channel: input.channel,
            destinationHash: hash,
            destinationReference,
            provider: this.providers[input.channel].name,
            providerMessageId: result.providerMessageId,
            state: 'sent',
            attemptNumber: claim.attemptNumber,
            safeFailureCode: null,
            createdAt: now,
            completedAt: now,
          }),
        );
        transaction.set(
          notificationReference,
          notificationEventDocumentSchema.parse({
            ...current,
            state: 'sent',
            leaseExpiresAt: null,
            lastSafeError: null,
            sentAt: now,
            updatedAt: now,
            updatedBy: 'system:outbox',
            version: current.version + 1,
          }),
        );
      });
      return { channel: input.channel, state: 'sent', terminal: true, replay: false };
    } catch (error) {
      const failure = safeFailure(error);
      const terminal = claim.attemptNumber >= maximumAttempts;
      await this.firestore.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(notificationReference);
        const current = notificationEventDocumentSchema.parse(currentSnapshot.data());
        const now = Timestamp.now();
        transaction.create(
          attemptReference,
          notificationAttemptDocumentSchema.parse({
            schemaVersion: 1,
            notificationEventId,
            channel: input.channel,
            destinationHash: hash,
            destinationReference,
            provider: this.providers[input.channel].name,
            providerMessageId: null,
            state: 'failed',
            attemptNumber: claim.attemptNumber,
            safeFailureCode: failure.code,
            createdAt: now,
            completedAt: now,
          }),
        );
        transaction.set(
          notificationReference,
          notificationEventDocumentSchema.parse({
            ...current,
            state: terminal ? 'failed' : 'pending',
            nextAttemptAt: Timestamp.fromDate(
              retryDate(now.toDate(), claim.attemptNumber),
            ),
            leaseExpiresAt: null,
            lastSafeError: failure.message,
            updatedAt: now,
            updatedBy: 'system:outbox',
            version: current.version + 1,
          }),
        );
      });
      return { channel: input.channel, state: 'failed', terminal, replay: false };
    }
  }
}

export function createNotificationService(input: {
  firestore?: Firestore;
  settings: NotificationRuntimeSettings;
  providers: ProviderSet;
  baseUrl: string;
}) {
  return new FirestoreNotificationService(
    input.firestore ?? getFirebaseAdminFirestore(),
    input.settings,
    input.providers,
    input.baseUrl.replace(/\/$/, ''),
  );
}

