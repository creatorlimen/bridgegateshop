import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { FinancialDocumentRecord } from '@/lib/schemas/financial';
import { renderFinancialDocumentPdf } from '@/lib/services/payments/renderFinancialDocumentPdf';
import {
  calculatePodTerms,
  type PodEligibilityInput,
  type PodEligibilityPolicy,
} from '@/lib/utils/payments/calculatePodTerms';

const policy: PodEligibilityPolicy = {
  enabled: true,
  allowedZoneIds: ['lagos-mainland'],
  excludedProductIds: ['product-excluded'],
  excludedVariantIds: ['variant-excluded'],
  restrictedOwnerUids: ['restricted-user'],
  restrictedEmails: ['restricted@example.com'],
  minimumOrderKobo: 100_000,
  maximumOrderKobo: 10_000_000,
  depositThresholdKobo: 5_000_000,
  depositBasisPoints: 3_000,
};

const eligibleInput: PodEligibilityInput = {
  ownerUid: null,
  email: 'customer@example.com',
  fulfilmentMethod: 'delivery',
  zoneId: 'lagos-mainland',
  productIds: ['product-safe'],
  variantIds: ['variant-safe'],
  grandTotalKobo: 5_000_000,
};

function financialDocument(): FinancialDocumentRecord {
  const issuedAt = new Date('2026-08-01T12:00:00.000Z');
  return {
    id: 'invoice-test-record',
    schemaVersion: 1,
    documentType: 'invoice',
    documentNumber: 'BGS-INV-ABCDEF12',
    orderId: 'order-test-record',
    orderReference: 'BGS-ABCDEF1234567890',
    paymentId: null,
    refundId: null,
    ownerUid: 'customer-test-record',
    guestAccessTokenHash: null,
    currency: 'NGN',
    amountKobo: 250_000,
    issuedAt,
    issuedAtIso: issuedAt.toISOString(),
    business: {
      name: 'Bridgegate Shop',
      address: '12 Example Avenue, Lagos',
      email: 'orders@example.com',
      phone: '+2348030000000',
      registrationNumber: null,
      taxNumber: null,
    },
    customer: {
      fullName: 'Ada Okafor',
      email: 'ada@example.com',
      phone: '+2348031234567',
      company: null,
    },
    fulfilment: {
      method: 'delivery',
      label: '12 Test Street, Lagos',
      deliveryFeeKobo: 50_000,
    },
    totals: {
      subtotalKobo: 200_000,
      discountKobo: 0,
      deliveryKobo: 50_000,
      taxKobo: 0,
      grandTotalKobo: 250_000,
      amountPaidKobo: 250_000,
      amountOutstandingKobo: 0,
      refundTotalKobo: 0,
    },
    lines: [
      {
        sku: 'BGS-TEST-001',
        description: 'Test product',
        quantity: 1,
        unitPriceKobo: 200_000,
        lineTotalKobo: 200_000,
        taxTreatment: 'notConfigured',
      },
    ],
    contentHash: 'a'.repeat(64),
    createdAt: issuedAt,
    createdBy: 'system:test',
  };
}

describe('Stage 6 payment policies and immutable documents', () => {
  it('uses the exact POD threshold as a zero-deposit boundary', () => {
    expect(calculatePodTerms(policy, eligibleInput)).toEqual({
      eligible: true,
      depositKobo: 0,
      outstandingKobo: 5_000_000,
    });

    expect(
      calculatePodTerms(policy, {
        ...eligibleInput,
        grandTotalKobo: 5_000_001,
      }),
    ).toEqual({
      eligible: true,
      depositKobo: 1_500_001,
      outstandingKobo: 3_500_000,
    });
  });

  it('rejects restricted customers, products, and delivery zones', () => {
    expect(
      calculatePodTerms(policy, {
        ...eligibleInput,
        email: 'RESTRICTED@example.com',
      }),
    ).toMatchObject({ eligible: false });
    expect(
      calculatePodTerms(policy, {
        ...eligibleInput,
        productIds: ['product-excluded'],
      }),
    ).toMatchObject({ eligible: false });
    expect(
      calculatePodTerms(policy, {
        ...eligibleInput,
        zoneId: 'lagos-island',
      }),
    ).toMatchObject({ eligible: false });
  });

  it('renders the same PDF bytes for the same immutable snapshot', () => {
    const first = renderFinancialDocumentPdf(financialDocument());
    const second = renderFinancialDocumentPdf(financialDocument());

    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    expect(first.toString('ascii')).toContain('BGS-INV-ABCDEF12');
    expect(first.toString('ascii')).toContain(`Integrity checksum: ${'a'.repeat(64)}`);
  });
});
