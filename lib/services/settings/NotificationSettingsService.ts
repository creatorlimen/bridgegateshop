import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { Role } from '@/lib/auth/roles';
import { getDefaultNotificationSettings } from '@/lib/config/notificationSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  notificationSettingsDocumentSchema,
  notificationTemplateDocumentSchema,
  type NotificationSettingsDocument,
  type NotificationTemplateDocument,
} from '@/lib/schemas/notification';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';

type SettingsActor = { actorId: string; roleIds: readonly Role[]; requestId: string };
type SaveSettingsInput = Pick<NotificationSettingsDocument, 'email' | 'sms'> & { expectedVersion: number };
type SaveTemplateInput = Pick<
  NotificationTemplateDocument,
  | 'fulfilmentStatus'
  | 'channel'
  | 'subjectTemplate'
  | 'bodyTemplate'
  | 'active'
  | 'providerTemplateId'
> & { expectedVersion: number };

export class NotificationSettingsError extends Error {
  constructor(readonly code: 'CONFLICT' | 'INVALID_STATE', message: string) {
    super(message);
    this.name = 'NotificationSettingsError';
  }
}

class FirestoreNotificationSettingsService {
  constructor(private readonly firestore: Firestore) {}

  async getRecord() {
    const snapshot = await this.firestore.collection(firestoreCollections.commerceSettings).doc('notifications').get();
    if (!snapshot.exists) return null;
    const parsed = notificationSettingsDocumentSchema.safeParse(snapshot.data());
    if (!parsed.success) throw new NotificationSettingsError('INVALID_STATE', 'Stored notification settings are invalid.');
    return parsed.data;
  }

  async listTemplates() {
    const snapshot = await this.firestore.collection(firestoreCollections.notificationTemplates).get();
    return snapshot.docs.map((documentSnapshot) => {
      const parsed = notificationTemplateDocumentSchema.safeParse(documentSnapshot.data());
      if (!parsed.success) throw new NotificationSettingsError('INVALID_STATE', 'Stored notification template is invalid.');
      return { id: documentSnapshot.id, ...parsed.data };
    });
  }

  async saveSettings(input: SaveSettingsInput, actor: SettingsActor) {
    const reference = this.firestore.collection(firestoreCollections.commerceSettings).doc('notifications');
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const parsed = snapshot.exists ? notificationSettingsDocumentSchema.safeParse(snapshot.data()) : null;
      if (snapshot.exists && !parsed?.success) throw new NotificationSettingsError('INVALID_STATE', 'Stored notification settings are invalid.');
      const existing = parsed?.success ? parsed.data : null;
      if ((existing?.version ?? 0) !== input.expectedVersion) throw new NotificationSettingsError('CONFLICT', 'Notification settings changed before this update.');
      const now = Timestamp.now();
      const nextVersion = input.expectedVersion + 1;
      const document = notificationSettingsDocumentSchema.parse({
        schemaVersion: 1,
        settingsKey: 'notifications',
        configurationVersion: `notifications-v${nextVersion}`,
        email: input.email,
        sms: input.sms,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: nextVersion,
      });
      transaction.set(reference, document);
      writeAuditEvent(transaction, this.firestore, { actorId: actor.actorId, actorRoleIds: actor.roleIds, action: 'settings.notifications.update', entityType: 'commerceSettings', entityId: 'notifications', requestId: actor.requestId, changedFields: ['email', 'sms'] });
      return document;
    });
  }

  async saveTemplate(input: SaveTemplateInput, actor: SettingsActor) {
    const templateId = `fulfilment-${input.fulfilmentStatus}-${input.channel}`;
    const reference = this.firestore.collection(firestoreCollections.notificationTemplates).doc(templateId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const parsed = snapshot.exists ? notificationTemplateDocumentSchema.safeParse(snapshot.data()) : null;
      if (snapshot.exists && !parsed?.success) throw new NotificationSettingsError('INVALID_STATE', 'Stored notification template is invalid.');
      const existing = parsed?.success ? parsed.data : null;
      if ((existing?.version ?? 0) !== input.expectedVersion) throw new NotificationSettingsError('CONFLICT', 'The notification template changed before this update.');
      const now = Timestamp.now();
      const nextVersion = input.expectedVersion + 1;
      const document = notificationTemplateDocumentSchema.parse({
        schemaVersion: 1,
        templateKey: `fulfilment.${input.fulfilmentStatus}.${input.channel}`,
        eventType: 'fulfilment.updated',
        fulfilmentStatus: input.fulfilmentStatus,
        channel: input.channel,
        locale: 'en-NG',
        subjectTemplate: input.channel === 'email' ? input.subjectTemplate : null,
        bodyTemplate: input.bodyTemplate,
        allowedVariables: ['customerName', 'orderReference', 'statusLabel', 'trackingUrl'],
        classification: 'transactional',
        active: input.active,
        templateVersion: `${templateId}-v${nextVersion}`,
        approvedAt: now,
        approvedBy: actor.actorId,
        providerTemplateId: input.providerTemplateId,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: nextVersion,
      });
      transaction.set(reference, document);
      writeAuditEvent(transaction, this.firestore, { actorId: actor.actorId, actorRoleIds: actor.roleIds, action: 'settings.notifications.template.update', entityType: 'notificationTemplate', entityId: templateId, requestId: actor.requestId, changedFields: ['subjectTemplate', 'bodyTemplate', 'active', 'providerTemplateId'] });
      return { id: templateId, ...document };
    });
  }

  getProviderConfigurationHealth() {
    return {
      email: Boolean(process.env.NOTIFICATION_EMAIL_GATEWAY_URL?.trim() && process.env.NOTIFICATION_EMAIL_GATEWAY_TOKEN?.trim()),
      sms: Boolean(process.env.NOTIFICATION_SMS_GATEWAY_URL?.trim() && process.env.NOTIFICATION_SMS_GATEWAY_TOKEN?.trim()),
    };
  }

  getDefaults() {
    return getDefaultNotificationSettings();
  }
}

export function createNotificationSettingsService(firestore: Firestore = getFirebaseAdminFirestore()) {
  return new FirestoreNotificationSettingsService(firestore);
}
