import 'server-only';

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import {
  getCheckoutSettings,
  type CheckoutSettings,
} from '@/lib/config/checkoutSettings';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';
import { firestoreCollections } from '@/lib/firebase/collections';
import type { OrderAccessProof } from '@/lib/repositories/orders/OrderRepository';
import { transferEvidenceDocumentSchema } from '@/lib/schemas/manualPayment';
import { orderDocumentSchema } from '@/lib/schemas/order';
import {
  createTransferEvidenceIntentInputSchema,
  finaliseTransferEvidenceInputSchema,
  transferEvidenceUploadIntentDocumentSchema,
  type CreateTransferEvidenceIntentInput,
  type FinaliseTransferEvidenceInput,
} from '@/lib/schemas/transferEvidenceUpload';
import { firestoreTimestampToDate } from '@/lib/schemas/common';
import { createFirebaseMediaStorage } from '@/lib/services/media/FirebaseMediaStorage';
import type { MediaStorage } from '@/lib/services/media/MediaStorage';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

const intentLifetimeMilliseconds = 15 * 60 * 1_000;

export class TransferEvidenceError extends Error {
  constructor(
    readonly code: 'PERMISSION_DENIED' | 'VALIDATION_FAILED' | 'NOT_FOUND' | 'INVALID_STATE' | 'PROVIDER_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'TransferEvidenceError';
  }
}

function safeHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertOwnership(
  record: { ownerUid: string | null; guestAccessTokenHash: string | null },
  proof: OrderAccessProof,
) {
  const customer = proof.ownerUid !== null && record.ownerUid === proof.ownerUid;
  const guest = Boolean(
    proof.guestTokenHash &&
      record.guestAccessTokenHash &&
      safeHashEquals(proof.guestTokenHash, record.guestAccessTokenHash),
  );
  if (!customer && !guest) throw new TransferEvidenceError('PERMISSION_DENIED', 'Evidence access was denied.');
}

function extensionFor(mimeType: string) {
  return mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
}

function hasValidSignature(content: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

class FirestoreTransferEvidenceService {
  constructor(
    private readonly firestore: Firestore,
    private readonly storage: MediaStorage,
    private readonly settings: CheckoutSettings,
  ) {}

  async createIntent(unparsedInput: CreateTransferEvidenceIntentInput, proof: OrderAccessProof) {
    const input = createTransferEvidenceIntentInputSchema.parse(unparsedInput);
    if (!this.settings.manualTransfer.evidenceUploadEnabled) {
      throw new TransferEvidenceError('INVALID_STATE', 'Transfer evidence upload is disabled.');
    }
    const orderReference = this.firestore.collection(firestoreCollections.orders).doc(input.orderId);
    const orderSnapshot = await orderReference.get();
    const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());
    if (!orderSnapshot.exists || !orderParse.success) throw new TransferEvidenceError('NOT_FOUND', 'Order was not found.');
    const order = { id: orderSnapshot.id, ...orderParse.data };
    assertOwnership(order, proof);
    if (order.paymentSelection.method !== 'manualTransfer' || order.orderStatus !== 'awaitingPayment') {
      throw new TransferEvidenceError('INVALID_STATE', 'This order is not accepting transfer evidence.');
    }
    const intentReference = this.firestore.collection(firestoreCollections.uploadIntents).doc();
    const extension = extensionFor(input.mimeType);
    const stagingStorageObjectPath = `quarantine/manual-transfer/${order.id}/${intentReference.id}-${randomUUID()}.${extension}`;
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + intentLifetimeMilliseconds);
    await intentReference.create(transferEvidenceUploadIntentDocumentSchema.parse({
      schemaVersion: 1,
      purpose: 'manualTransferEvidence',
      orderId: order.id,
      ownerUid: order.ownerUid,
      guestAccessTokenHash: order.guestAccessTokenHash,
      originalFileName: input.fileName.replace(/[\\/]/g, '_'),
      declaredMimeType: input.mimeType,
      declaredBytes: input.bytes,
      stagingStorageObjectPath,
      status: 'pending',
      createdAt: now,
      expiresAt,
      finalisedAt: null,
      evidenceId: null,
      safeFailureCode: null,
    }));
    try {
      const uploadUrl = await this.storage.createWriteUrl({
        storageObjectPath: stagingStorageObjectPath,
        contentType: input.mimeType,
        expiresAt: expiresAt.toDate(),
      });
      return {
        uploadIntentId: intentReference.id,
        uploadUrl,
        requiredHeaders: { 'Content-Type': input.mimeType },
        expiresAt: expiresAt.toDate().toISOString(),
      };
    } catch {
      await intentReference.update({ status: 'failed', safeFailureCode: 'SIGNED_UPLOAD_UNAVAILABLE' });
      throw new TransferEvidenceError('PROVIDER_UNAVAILABLE', 'Secure evidence upload is temporarily unavailable.');
    }
  }

  async finalise(unparsedInput: FinaliseTransferEvidenceInput, proof: OrderAccessProof) {
    const input = finaliseTransferEvidenceInputSchema.parse(unparsedInput);
    const intentReference = this.firestore.collection(firestoreCollections.uploadIntents).doc(input.uploadIntentId);
    const intentSnapshot = await intentReference.get();
    const intentParse = transferEvidenceUploadIntentDocumentSchema.safeParse(intentSnapshot.data());
    if (!intentSnapshot.exists || !intentParse.success) throw new TransferEvidenceError('NOT_FOUND', 'Upload intent was not found.');
    const intent = intentParse.data;
    assertOwnership(intent, proof);
    if (intent.status === 'finalised' && intent.evidenceId) return { evidenceId: intent.evidenceId, replay: true };
    if (intent.status !== 'pending' || firestoreTimestampToDate(intent.expiresAt).getTime() <= Date.now()) {
      throw new TransferEvidenceError('INVALID_STATE', 'The evidence upload intent expired.');
    }
    const metadata = await this.storage.getObjectMetadata(intent.stagingStorageObjectPath);
    if (metadata.bytes !== intent.declaredBytes || metadata.contentType !== intent.declaredMimeType) {
      throw new TransferEvidenceError('VALIDATION_FAILED', 'Uploaded evidence metadata does not match the request.');
    }
    const content = await this.storage.downloadObject(intent.stagingStorageObjectPath);
    if (content.byteLength !== intent.declaredBytes || !hasValidSignature(content, intent.declaredMimeType)) {
      throw new TransferEvidenceError('VALIDATION_FAILED', 'Uploaded evidence has an invalid file signature.');
    }
    const contentHash = createHash('sha256').update(content).digest('hex');
    const evidenceId = createDeterministicId('evidence', `${intent.orderId}:${contentHash}`);
    const destinationPath = `private/manual-transfer-evidence/${intent.orderId}/${evidenceId}.${extensionFor(intent.declaredMimeType)}`;
    await this.storage.copyObject(intent.stagingStorageObjectPath, destinationPath);
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + this.settings.manualTransfer.evidenceRetentionDays * 24 * 60 * 60 * 1_000);
    await this.firestore.runTransaction(async (transaction) => {
      const [currentIntentSnapshot, orderSnapshot, evidenceSnapshot] = await transaction.getAll(
        intentReference,
        this.firestore.collection(firestoreCollections.orders).doc(intent.orderId),
        this.firestore.collection(firestoreCollections.transferEvidence).doc(evidenceId),
      );
      const currentIntentParse = transferEvidenceUploadIntentDocumentSchema.safeParse(currentIntentSnapshot.data());
      const orderParse = orderDocumentSchema.safeParse(orderSnapshot.data());
      if (!currentIntentParse.success || !orderParse.success) throw new TransferEvidenceError('INVALID_STATE', 'Evidence finalisation state is invalid.');
      assertOwnership(orderParse.data, proof);
      if (!evidenceSnapshot.exists) {
        transaction.create(evidenceSnapshot.ref, transferEvidenceDocumentSchema.parse({
          schemaVersion: 1,
          orderId: intent.orderId,
          ownerUid: intent.ownerUid,
          guestAccessTokenHash: intent.guestAccessTokenHash,
          storageObjectPath: destinationPath,
          originalFileName: intent.originalFileName,
          mimeType: intent.declaredMimeType,
          bytes: intent.declaredBytes,
          contentHash,
          status: 'submitted',
          submittedAt: now,
          expiresAt,
          createdAt: now,
          createdBy: proof.ownerUid ?? 'system:guest-customer',
          updatedAt: now,
          updatedBy: proof.ownerUid ?? 'system:guest-customer',
          version: 1,
        }));
      }
      transaction.set(intentReference, transferEvidenceUploadIntentDocumentSchema.parse({
        ...currentIntentParse.data,
        status: 'finalised',
        finalisedAt: now,
        evidenceId,
      }));
    });
    await this.storage.deleteObject(intent.stagingStorageObjectPath);
    return { evidenceId, replay: false };
  }
}

export function createTransferEvidenceService(
  firestore: Firestore = getFirebaseAdminFirestore(),
  storage: MediaStorage = createFirebaseMediaStorage(),
  settings: CheckoutSettings = getCheckoutSettings(),
) {
  return new FirestoreTransferEvidenceService(firestore, storage, settings);
}
