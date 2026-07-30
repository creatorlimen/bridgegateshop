const nairaFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMoney(amountKobo: number) {
  if (!Number.isSafeInteger(amountKobo)) {
    throw new Error('Money must be represented as a safe integer in kobo.');
  }

  return nairaFormatter.format(amountKobo / 100);
}
