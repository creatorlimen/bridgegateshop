import { z } from 'zod';

import {
  actorReferenceSchema,
  firestoreDocumentIdSchema,
  firestoreTimestampSchema,
} from '@/lib/schemas/common';

const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const integrityHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const financialLineSchema = z
  .object({
    sku: z.string().min(1).max(80),
    description: z.string().min(1).max(280),
    quantity: z.number().int().positive().max(100),
    unitPriceKobo: moneySchema,
    lineTotalKobo: moneySchema,
    taxTreatment: z.string().min(1).max(80),
  })
  .strict()
  .refine((line) => line.lineTotalKobo === line.unitPriceKobo * line.quantity, {
    message: 'Financial line total does not reconcile.',
  });

export const financialDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    documentType: z.enum(['invoice', 'receipt', 'creditNote']),
    documentNumber: z.string().regex(/^BGS-(INV|RCT|CRN)-[A-Z0-9-]{8,80}$/),
    orderId: firestoreDocumentIdSchema,
    orderReference: z.string().regex(/^BGS-[A-Z0-9]{16}$/),
    paymentId: firestoreDocumentIdSchema.nullable(),
    refundId: firestoreDocumentIdSchema.nullable(),
    ownerUid: actorReferenceSchema.nullable(),
    guestAccessTokenHash: integrityHashSchema.nullable(),
    currency: z.literal('NGN'),
    amountKobo: moneySchema,
    issuedAt: firestoreTimestampSchema,
    issuedAtIso: z.string().datetime(),
    business: z
      .object({
        name: z.string().min(2).max(160),
        address: z.string().min(3).max(500),
        email: z.string().email().max(320),
        phone: z.string().min(7).max(40),
        registrationNumber: z.string().max(120).nullable(),
        taxNumber: z.string().max(120).nullable(),
      })
      .strict(),
    customer: z
      .object({
        fullName: z.string().min(2).max(160),
        email: z.string().email().max(320),
        phone: z.string().min(7).max(40),
        company: z.string().max(160).nullable(),
      })
      .strict(),
    fulfilment: z
      .object({
        method: z.enum(['delivery', 'pickup']),
        label: z.string().min(1).max(500),
        deliveryFeeKobo: moneySchema,
      })
      .strict(),
    totals: z
      .object({
        subtotalKobo: moneySchema,
        discountKobo: moneySchema,
        deliveryKobo: moneySchema,
        taxKobo: moneySchema,
        grandTotalKobo: moneySchema,
        amountPaidKobo: moneySchema,
        amountOutstandingKobo: moneySchema,
        refundTotalKobo: moneySchema,
      })
      .strict(),
    lines: z.array(financialLineSchema).min(1).max(50),
    contentHash: integrityHashSchema,
    createdAt: firestoreTimestampSchema,
    createdBy: actorReferenceSchema,
  })
  .strict()
  .superRefine((document, context) => {
    const ownerCount = Number(document.ownerUid !== null) + Number(document.guestAccessTokenHash !== null);
    if (ownerCount !== 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Financial document ownership is invalid.', path: ['ownerUid'] });
    }
  });

export type FinancialDocument = z.infer<typeof financialDocumentSchema>;
export type FinancialDocumentRecord = FinancialDocument & { id: string };
