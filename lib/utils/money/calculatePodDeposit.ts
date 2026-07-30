type PodDepositInput = {
  grandTotalKobo: number;
  thresholdKobo: number;
  depositBasisPoints: number;
};

export function calculatePodDeposit({
  grandTotalKobo,
  thresholdKobo,
  depositBasisPoints,
}: PodDepositInput) {
  const moneyValues = [grandTotalKobo, thresholdKobo];

  if (moneyValues.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('POD money values must be non-negative integer kobo.');
  }

  if (
    !Number.isInteger(depositBasisPoints) ||
    depositBasisPoints < 0 ||
    depositBasisPoints > 10000
  ) {
    throw new Error('Deposit basis points must be between 0 and 10,000.');
  }

  if (grandTotalKobo <= thresholdKobo) {
    return 0;
  }

  const wholeBasisPointGroups =
    Math.floor(grandTotalKobo / 10000) * depositBasisPoints;
  const remainingKobo = grandTotalKobo % 10000;
  const depositKobo =
    wholeBasisPointGroups +
    Math.ceil((remainingKobo * depositBasisPoints) / 10000);

  if (!Number.isSafeInteger(depositKobo)) {
    throw new Error('Calculated POD deposit exceeds the safe money range.');
  }

  return depositKobo;
}
