import 'server-only';

import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import type { Role } from '@/lib/auth/roles';
import { getDefaultFulfilmentSettings } from '@/lib/config/fulfilmentSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  businessCalendarDocumentSchema,
  deliveryZoneDocumentSchema,
  fulfilmentSettingsDocumentSchema,
  type BusinessCalendarDocument,
  type DeliveryZoneDocument,
  type FulfilmentSettingsDocument,
} from '@/lib/schemas/fulfilment';
import { writeAuditEvent } from '@/lib/services/audit/writeAuditEvent';

type SettingsActor = {
  actorId: string;
  roleIds: readonly Role[];
  requestId: string;
};

type SaveGlobalInput = Pick<
  FulfilmentSettingsDocument,
  'pickup' | 'supportWhatsappPhone' | 'trackingRateLimit'
> & { expectedVersion: number };

type SaveZoneInput = Omit<
  DeliveryZoneDocument,
  'schemaVersion' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'version'
> & {
  zoneId: string;
  expectedVersion: number;
  expectedSettingsVersion: number;
};

type SaveCalendarInput = Omit<
  BusinessCalendarDocument,
  'schemaVersion' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy' | 'version'
> & {
  expectedVersion: number;
  expectedSettingsVersion: number;
};

export class FulfilmentSettingsError extends Error {
  constructor(readonly code: 'CONFLICT' | 'INVALID_STATE', message: string) {
    super(message);
    this.name = 'FulfilmentSettingsError';
  }
}

class FirestoreFulfilmentSettingsService {
  constructor(private readonly firestore: Firestore) {}

  async getRecord() {
    const snapshot = await this.settingsReference().get();
    if (!snapshot.exists) return null;
    const parsed = fulfilmentSettingsDocumentSchema.safeParse(snapshot.data());
    if (!parsed.success) throw new FulfilmentSettingsError('INVALID_STATE', 'Stored fulfilment settings are invalid.');
    return parsed.data;
  }

  async listZoneRecords() {
    const snapshot = await this.firestore
      .collection(firestoreCollections.deliveryZones)
      .orderBy('priority', 'asc')
      .get();
    return snapshot.docs.map((documentSnapshot) => {
      const parsed = deliveryZoneDocumentSchema.safeParse(documentSnapshot.data());
      if (!parsed.success) throw new FulfilmentSettingsError('INVALID_STATE', 'Stored delivery-zone data is invalid.');
      return { id: documentSnapshot.id, ...parsed.data };
    });
  }

  async listCalendarRecords() {
    const snapshot = await this.firestore
      .collection(firestoreCollections.businessCalendar)
      .orderBy('date', 'asc')
      .limit(366)
      .get();
    return snapshot.docs.map((documentSnapshot) => {
      const parsed = businessCalendarDocumentSchema.safeParse(documentSnapshot.data());
      if (!parsed.success) throw new FulfilmentSettingsError('INVALID_STATE', 'Stored calendar data is invalid.');
      return { id: documentSnapshot.id, ...parsed.data };
    });
  }

  async saveGlobal(input: SaveGlobalInput, actor: SettingsActor) {
    const reference = this.settingsReference();
    return this.firestore.runTransaction(async (transaction) => {
      const existing = await this.parseSettings(transaction, input.expectedVersion);
      const now = Timestamp.now();
      const nextVersion = input.expectedVersion + 1;
      const document = fulfilmentSettingsDocumentSchema.parse({
        schemaVersion: 1,
        settingsKey: 'fulfilment',
        configurationVersion: `fulfilment-v${nextVersion}`,
        pickup: input.pickup,
        supportWhatsappPhone: input.supportWhatsappPhone,
        trackingRateLimit: input.trackingRateLimit,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: nextVersion,
      });
      transaction.set(reference, document);
      this.audit(transaction, actor, ['pickup', 'supportWhatsappPhone', 'trackingRateLimit']);
      return document;
    });
  }

  async saveZone(input: SaveZoneInput, actor: SettingsActor) {
    const { zoneId, expectedVersion, expectedSettingsVersion, ...zoneInput } = input;
    const zoneReference = this.firestore
      .collection(firestoreCollections.deliveryZones)
      .doc(zoneId);
    return this.firestore.runTransaction(async (transaction) => {
      const [settingsSnapshot, zoneSnapshot] = await transaction.getAll(
        this.settingsReference(),
        zoneReference,
      );
      const settings = this.parseSettingsSnapshot(settingsSnapshot, expectedSettingsVersion);
      const existingParse = zoneSnapshot.exists
        ? deliveryZoneDocumentSchema.safeParse(zoneSnapshot.data())
        : null;
      if (zoneSnapshot.exists && !existingParse?.success) throw new FulfilmentSettingsError('INVALID_STATE', 'Stored delivery-zone data is invalid.');
      const existing = existingParse?.success ? existingParse.data : null;
      if ((existing?.version ?? 0) !== expectedVersion) throw new FulfilmentSettingsError('CONFLICT', 'The delivery zone changed before this update.');
      const now = Timestamp.now();
      const zone = deliveryZoneDocumentSchema.parse({
        ...zoneInput,
        schemaVersion: 1,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: expectedVersion + 1,
      });
      transaction.set(zoneReference, zone);
      transaction.set(this.settingsReference(), this.bumpSettings(settings, actor, now));
      this.audit(transaction, actor, [`deliveryZones.${zoneId}`]);
      return zone;
    });
  }

  async saveCalendarDate(input: SaveCalendarInput, actor: SettingsActor) {
    const { expectedVersion, expectedSettingsVersion, ...calendarInput } = input;
    const calendarReference = this.firestore
      .collection(firestoreCollections.businessCalendar)
      .doc(calendarInput.date);
    return this.firestore.runTransaction(async (transaction) => {
      const [settingsSnapshot, calendarSnapshot] = await transaction.getAll(
        this.settingsReference(),
        calendarReference,
      );
      const settings = this.parseSettingsSnapshot(settingsSnapshot, expectedSettingsVersion);
      const existingParse = calendarSnapshot.exists
        ? businessCalendarDocumentSchema.safeParse(calendarSnapshot.data())
        : null;
      if (calendarSnapshot.exists && !existingParse?.success) throw new FulfilmentSettingsError('INVALID_STATE', 'Stored calendar data is invalid.');
      const existing = existingParse?.success ? existingParse.data : null;
      if ((existing?.version ?? 0) !== expectedVersion) throw new FulfilmentSettingsError('CONFLICT', 'The business-calendar date changed before this update.');
      const now = Timestamp.now();
      const calendar = businessCalendarDocumentSchema.parse({
        ...calendarInput,
        schemaVersion: 1,
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actor.actorId,
        updatedAt: now,
        updatedBy: actor.actorId,
        version: expectedVersion + 1,
      });
      transaction.set(calendarReference, calendar);
      transaction.set(this.settingsReference(), this.bumpSettings(settings, actor, now));
      this.audit(transaction, actor, [`businessCalendar.${calendarInput.date}`]);
      return calendar;
    });
  }

  private settingsReference() {
    return this.firestore
      .collection(firestoreCollections.commerceSettings)
      .doc('fulfilment');
  }

  private async parseSettings(transaction: Transaction, expectedVersion: number) {
    return this.parseSettingsSnapshot(
      await transaction.get(this.settingsReference()),
      expectedVersion,
    );
  }

  private parseSettingsSnapshot(
    snapshot: FirebaseFirestore.DocumentSnapshot,
    expectedVersion: number,
  ) {
    const parsed = snapshot.exists
      ? fulfilmentSettingsDocumentSchema.safeParse(snapshot.data())
      : null;
    if (snapshot.exists && !parsed?.success) throw new FulfilmentSettingsError('INVALID_STATE', 'Stored fulfilment settings are invalid.');
    const existing = parsed?.success ? parsed.data : null;
    if ((existing?.version ?? 0) !== expectedVersion) throw new FulfilmentSettingsError('CONFLICT', 'Fulfilment settings changed before this update.');
    return existing;
  }

  private bumpSettings(
    settings: FulfilmentSettingsDocument | null,
    actor: SettingsActor,
    now: Timestamp,
  ) {
    const defaults = getDefaultFulfilmentSettings();
    const nextVersion = (settings?.version ?? 0) + 1;
    return fulfilmentSettingsDocumentSchema.parse({
      schemaVersion: 1,
      settingsKey: 'fulfilment',
      configurationVersion: `fulfilment-v${nextVersion}`,
      pickup: settings?.pickup ?? defaults.pickup,
      supportWhatsappPhone: settings?.supportWhatsappPhone ?? defaults.supportWhatsappPhone,
      trackingRateLimit: settings?.trackingRateLimit ?? defaults.trackingRateLimit,
      createdAt: settings?.createdAt ?? now,
      createdBy: settings?.createdBy ?? actor.actorId,
      updatedAt: now,
      updatedBy: actor.actorId,
      version: nextVersion,
    });
  }

  private audit(transaction: Transaction, actor: SettingsActor, changedFields: string[]) {
    writeAuditEvent(transaction, this.firestore, {
      actorId: actor.actorId,
      actorRoleIds: actor.roleIds,
      action: 'settings.fulfilment.update',
      entityType: 'commerceSettings',
      entityId: 'fulfilment',
      requestId: actor.requestId,
      changedFields,
    });
  }
}

export function createFulfilmentSettingsService(
  firestore: Firestore = getFirebaseAdminFirestore(),
) {
  return new FirestoreFulfilmentSettingsService(firestore);
}




