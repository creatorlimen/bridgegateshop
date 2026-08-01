import 'server-only';

import { createHash } from 'node:crypto';

import type { Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';

import type { CheckoutSettings } from '@/lib/config/checkoutSettings';
import { firestoreCollections } from '@/lib/firebase/collections';
import {
  financialDocumentSchema,
  type FinancialDocument,
} from '@/lib/schemas/financial';
import type {
  OrderItemDocument,
  OrderRecord,
} from '@/lib/schemas/order';
import { createDeterministicId } from '@/lib/services/payments/paymentReferences';

type DocumentKind = FinancialDocument['documentType'];

type IssueDocumentInput = {
  transaction: Transaction;
  firestore: Firestore;
  order: OrderRecord;
  items: readonly OrderItemDocument[];
  settings: CheckoutSettings;
  documentType: DocumentKind;
  amountKobo: number;
  paymentId: string | null;
  refundId: string | null;
  actorId: string;
  now: Timestamp;
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function getDocumentIdentity(
  documentType: DocumentKind,
  order: OrderRecord,
  paymentId: string | null,
  refundId: string | null,
) {
  const source =
    documentType === 'invoice'
      ? order.reference
      : documentType === 'receipt'
        ? paymentId
        : refundId;

  if (!source) throw new Error('Financial document source is required.');

  const suffix =
    documentType === 'invoice'
      ? order.reference.slice(4)
      : createHash('sha256').update(source).digest('hex').slice(0, 20).toUpperCase();
  const prefix =
    documentType === 'invoice' ? 'INV' : documentType === 'receipt' ? 'RCT' : 'CRN';

  return {
    documentId: createDeterministicId('financial', `${documentType}:${source}`),
    documentNumber: `BGS-${prefix}-${suffix}`,
  };
}

function getFulfilmentLabel(order: OrderRecord) {
  if (order.fulfilment.method === 'pickup') {
    return `${order.fulfilment.pickupLabel}: ${order.fulfilment.pickupAddress}`;
  }

  const address = order.fulfilment.address;
  return [
    address?.line1,
    address?.line2,
    address?.landmark,
    address?.city,
    address?.state,
  ]
    .filter(Boolean)
    .join(', ');
}

export function writeFinancialDocumentInTransaction(
  input: IssueDocumentInput,
) {
  const { documentId, documentNumber } = getDocumentIdentity(
    input.documentType,
    input.order,
    input.paymentId,
    input.refundId,
  );
  const issuedAtIso = input.now.toDate().toISOString();
  const snapshot = {
    documentType: input.documentType,
    documentNumber,
    orderReference: input.order.reference,
    currency: 'NGN' as const,
    amountKobo: input.amountKobo,
    issuedAtIso,
    business: {
      name: input.settings.financialDocuments.businessName,
      address: input.settings.financialDocuments.businessAddress,
      email: input.settings.financialDocuments.businessEmail,
      phone: input.settings.financialDocuments.businessPhone,
      registrationNumber:
        input.settings.financialDocuments.registrationNumber,
      taxNumber: input.settings.financialDocuments.taxNumber,
    },
    customer: input.order.customer,
    fulfilment: {
      method: input.order.fulfilment.method,
      label: getFulfilmentLabel(input.order),
      deliveryFeeKobo: input.order.totals.deliveryKobo,
    },
    totals: {
      subtotalKobo: input.order.totals.subtotalKobo,
      discountKobo: input.order.totals.discountKobo,
      deliveryKobo: input.order.totals.deliveryKobo,
      taxKobo: input.order.totals.taxKobo,
      grandTotalKobo: input.order.totals.grandTotalKobo,
      amountPaidKobo: input.order.totals.amountPaidKobo,
      amountOutstandingKobo: input.order.totals.amountOutstandingKobo,
      refundTotalKobo: input.order.refundTotalKobo,
    },
    lines: input.items.map((item) => ({
      sku: item.sku,
      description: `${item.productName} - ${item.variantName} (${item.packageLabel})`,
      quantity: item.quantity,
      unitPriceKobo: item.unitPriceKobo,
      lineTotalKobo: item.lineTotalKobo,
      taxTreatment: item.taxTreatment,
    })),
  };
  const document = financialDocumentSchema.parse({
    schemaVersion: 1,
    ...snapshot,
    orderId: input.order.id,
    paymentId: input.paymentId,
    refundId: input.refundId,
    ownerUid: input.order.ownerUid,
    guestAccessTokenHash: input.order.guestAccessTokenHash,
    issuedAt: input.now,
    contentHash: createHash('sha256')
      .update(stableSerialize(snapshot))
      .digest('hex'),
    createdAt: input.now,
    createdBy: input.actorId,
  });

  input.transaction.create(
    input.firestore
      .collection(firestoreCollections.financialDocuments)
      .doc(documentId),
    document,
  );

  return { id: documentId, ...document };
}
