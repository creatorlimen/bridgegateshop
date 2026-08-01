import { describe, expect, it } from 'vitest';

import { createCheckoutOrderInputSchema } from '@/lib/schemas/checkout';
import { orderDocumentSchema } from '@/lib/schemas/order';

const baseCheckoutInput = {
  fullName: 'Ada Okafor',
  email: 'ADA@example.com',
  phone: '0803 123 4567',
  company: null,
  customerNote: null,
  paymentMethod: 'paystack' as const,
  expectedCartVersion: 3,
  idempotencyKey: 'checkout-unit-test-001',
  termsAccepted: true as const,
  privacyAccepted: true as const,
};

describe('Stage 6 checkout and order schemas', () => {
  it('normalises Nigerian phone and email values', () => {
    const checkout = createCheckoutOrderInputSchema.parse({
      ...baseCheckoutInput,
      fulfilmentMethod: 'pickup',
      deliveryAddress: null,
    });

    expect(checkout.phone).toBe('+2348031234567');
    expect(checkout.email).toBe('ada@example.com');
  });

  it('rejects a delivery checkout without an address', () => {
    expect(() =>
      createCheckoutOrderInputSchema.parse({
        ...baseCheckoutInput,
        fulfilmentMethod: 'delivery',
        deliveryAddress: null,
      }),
    ).toThrow();
  });

  it('rejects order totals that do not reconcile in integer kobo', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const baseOrder = {
      schemaVersion: 1,
      reference: 'BGS-0123456789ABCDEF',
      ownerUid: 'customer-unit-test',
      guestAccessTokenHash: null,
      source: 'web',
      currency: 'NGN',
      cartId: 'cart-unit-test',
      reservationId: 'reservation-unit-test',
      customer: {
        fullName: 'Ada Okafor',
        email: 'ada@example.com',
        phone: '+2348031234567',
        company: null,
      },
      fulfilment: {
        method: 'pickup',
        address: null,
        zoneId: null,
        zoneName: null,
        feeKobo: 0,
        estimateLabel: 'Pickup timing is confirmed after acceptance.',
        pickupLabel: 'Specta pickup',
        pickupAddress: 'Placeholder pickup address.',
        pickupOpeningHours: 'Placeholder opening hours.',
      },
      totals: {
        subtotalKobo: 1_000,
        discountKobo: 0,
        deliveryKobo: 0,
        taxKobo: 0,
        grandTotalKobo: 999,
        amountPaidKobo: 0,
        amountOutstandingKobo: 999,
      },
      paymentSelection: {
        method: 'paystack',
        payableNowKobo: 999,
        depositKobo: 0,
        outstandingAfterInitialPaymentKobo: 0,
      },
      policyEvidence: {
        termsPolicyId: 'terms',
        termsVersion: 'v1',
        privacyPolicyId: 'privacy',
        privacyVersion: 'v1',
        acceptedAt: now,
      },
      customerNote: null,
      orderStatus: 'awaitingPayment',
      paymentStatus: 'pending',
      fulfilmentStatus: 'unfulfilled',
      cancellationSummary: null,
      refundTotalKobo: 0,
      assignedStaffUid: null,
      internalNoteCount: 0,
      checkoutIdempotencyKey: 'checkout-unit-test-001',
      checkoutRequestHash: 'a'.repeat(64),
      placedAt: now,
      confirmedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: now,
      createdBy: 'customer-unit-test',
      updatedAt: now,
      updatedBy: 'customer-unit-test',
      version: 1,
    };

    expect(orderDocumentSchema.safeParse(baseOrder).success).toBe(false);
  });
});

