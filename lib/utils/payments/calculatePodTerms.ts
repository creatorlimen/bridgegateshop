export type PodEligibilityPolicy = {
  enabled: boolean;
  allowedZoneIds: readonly string[];
  excludedProductIds: readonly string[];
  excludedVariantIds: readonly string[];
  restrictedOwnerUids: readonly string[];
  restrictedEmails: readonly string[];
  minimumOrderKobo: number;
  maximumOrderKobo: number;
  depositThresholdKobo: number;
  depositBasisPoints: number;
};

export type PodEligibilityInput = {
  ownerUid: string | null;
  email: string;
  fulfilmentMethod: 'delivery' | 'pickup';
  zoneId: string | null;
  productIds: readonly string[];
  variantIds: readonly string[];
  grandTotalKobo: number;
};

export type PodTerms =
  | { eligible: true; depositKobo: number; outstandingKobo: number }
  | { eligible: false; reason: string };

export function calculatePercentageKobo(
  amountKobo: number,
  basisPoints: number,
) {
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 0) {
    throw new Error('Amount must be a non-negative integer number of kobo.');
  }
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new Error('Basis points must be an integer between 0 and 10,000.');
  }

  return Math.ceil((amountKobo * basisPoints) / 10_000);
}

export function calculatePodTerms(
  policy: PodEligibilityPolicy,
  input: PodEligibilityInput,
): PodTerms {
  if (!policy.enabled) return { eligible: false, reason: 'Pay on Delivery is disabled.' };
  if (input.fulfilmentMethod !== 'delivery' || !input.zoneId) {
    return { eligible: false, reason: 'Pay on Delivery requires an eligible delivery address.' };
  }
  if (!policy.allowedZoneIds.includes(input.zoneId)) {
    return { eligible: false, reason: 'Pay on Delivery is unavailable for this delivery zone.' };
  }
  if (
    input.grandTotalKobo < policy.minimumOrderKobo ||
    input.grandTotalKobo > policy.maximumOrderKobo
  ) {
    return { eligible: false, reason: 'This order value is outside the Pay on Delivery range.' };
  }
  if (input.ownerUid && policy.restrictedOwnerUids.includes(input.ownerUid)) {
    return { eligible: false, reason: 'Pay on Delivery is unavailable for this account.' };
  }
  if (policy.restrictedEmails.includes(input.email.toLowerCase())) {
    return { eligible: false, reason: 'Pay on Delivery is unavailable for this account.' };
  }
  if (input.productIds.some((id) => policy.excludedProductIds.includes(id))) {
    return { eligible: false, reason: 'A product in this order is not eligible for Pay on Delivery.' };
  }
  if (input.variantIds.some((id) => policy.excludedVariantIds.includes(id))) {
    return { eligible: false, reason: 'A product option in this order is not eligible for Pay on Delivery.' };
  }

  const depositKobo =
    input.grandTotalKobo > policy.depositThresholdKobo
      ? calculatePercentageKobo(input.grandTotalKobo, policy.depositBasisPoints)
      : 0;

  return {
    eligible: true,
    depositKobo,
    outstandingKobo: input.grandTotalKobo - depositKobo,
  };
}
