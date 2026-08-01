import { z } from 'zod';

import { firestoreDocumentIdSchema } from '@/lib/schemas/common';
import {
  customerNameSchema,
  nigerianPhoneNumberSchema,
} from '@/lib/schemas/customer';

export const checkoutPaymentMethodSchema = z.enum([
  'paystack',
  'pod',
  'manualTransfer',
]);

export const checkoutDeliveryAddressSchema = z
  .object({
    recipientName: customerNameSchema,
    phone: nigerianPhoneNumberSchema,
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).nullable(),
    landmark: z.string().trim().max(200).nullable(),
    city: z.string().trim().min(2).max(100),
    state: z.literal('Lagos'),
    zoneId: firestoreDocumentIdSchema,
  })
  .strict();

const checkoutBaseSchema = z.object({
  fullName: customerNameSchema,
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  phone: nigerianPhoneNumberSchema,
  company: z.string().trim().max(160).nullable(),
  customerNote: z.string().trim().max(1_000).nullable(),
  paymentMethod: checkoutPaymentMethodSchema,
  expectedCartVersion: z.number().int().positive(),
  idempotencyKey: z
    .string()
    .trim()
    .min(16)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/),
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
});

export const createCheckoutOrderInputSchema = z.discriminatedUnion(
  'fulfilmentMethod',
  [
    checkoutBaseSchema.extend({
      fulfilmentMethod: z.literal('delivery'),
      deliveryAddress: checkoutDeliveryAddressSchema,
    }),
    checkoutBaseSchema.extend({
      fulfilmentMethod: z.literal('pickup'),
      deliveryAddress: z.null(),
    }),
  ],
);

export type CheckoutPaymentMethod = z.infer<
  typeof checkoutPaymentMethodSchema
>;
export type CheckoutDeliveryAddress = z.infer<
  typeof checkoutDeliveryAddressSchema
>;
export type CreateCheckoutOrderInput = z.infer<
  typeof createCheckoutOrderInputSchema
>;

