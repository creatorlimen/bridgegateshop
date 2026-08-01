import { z } from 'zod';

import { mutableRecordFieldsSchema } from '@/lib/schemas/common';

const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const commercePaymentSettingsDocumentSchema =
  mutableRecordFieldsSchema.extend({
    settingsKey: z.literal('payments'),
    configurationVersion: z.string().min(1).max(120),
    pod: z
      .object({
        enabled: z.boolean(),
        allowedZoneIds: z.array(z.string().min(1).max(120)).max(50),
        excludedProductIds: z.array(z.string().min(1).max(128)).max(500),
        excludedVariantIds: z.array(z.string().min(1).max(128)).max(1_000),
        restrictedOwnerUids: z.array(z.string().min(1).max(128)).max(500),
        restrictedEmails: z.array(z.string().email().max(320)).max(500),
        minimumOrderKobo: moneySchema,
        maximumOrderKobo: moneySchema,
        depositThresholdKobo: moneySchema,
        depositBasisPoints: z.number().int().min(0).max(10_000),
        confirmationMode: z.literal('staffApproval'),
        holdMinutes: z.number().int().min(5).max(1_440),
      })
      .strict()
      .refine(
        (pod) => pod.maximumOrderKobo >= pod.minimumOrderKobo,
        'POD maximum must not be below its minimum.',
      ),
    manualTransfer: z
      .object({
        enabled: z.boolean(),
        holdHours: z.number().int().min(1).max(72),
        allowPartialPayments: z.boolean(),
        evidenceUploadEnabled: z.boolean(),
        evidenceRetentionDays: z.number().int().min(1).max(2_555),
        instructionsVersion: z.string().min(1).max(120),
        instructions: z
          .object({
            bankName: z.string().min(2).max(160),
            accountName: z.string().min(2).max(160),
            accountNumber: z.string().regex(/^\d{10}$/),
            customerMessage: z.string().min(3).max(500),
          })
          .strict(),
      })
      .strict(),
    financialDocuments: z
      .object({
        businessName: z.string().min(2).max(160),
        businessAddress: z.string().min(3).max(500),
        businessEmail: z.string().email().max(320),
        businessPhone: z.string().min(7).max(40),
        registrationNumber: z.string().max(120).nullable(),
        taxNumber: z.string().max(120).nullable(),
      })
      .strict(),
  });

export type CommercePaymentSettingsDocument = z.infer<
  typeof commercePaymentSettingsDocumentSchema
>;
