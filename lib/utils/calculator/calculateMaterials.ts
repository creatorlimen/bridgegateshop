type MaterialCalculationInput = {
  lengthMillimetres: number;
  widthOrHeightMillimetres: number;
  coverageSquareMetresPerUnit: number;
  wastageBasisPoints: number;
  unitPriceKobo: number;
};

export type MaterialCalculationResult = {
  areaSquareMetres: number;
  rawUnits: number;
  purchasableUnits: number;
  estimatedCostKobo: number;
};

export function calculateMaterials({
  lengthMillimetres,
  widthOrHeightMillimetres,
  coverageSquareMetresPerUnit,
  wastageBasisPoints,
  unitPriceKobo,
}: MaterialCalculationInput): MaterialCalculationResult {
  if (
    !Number.isSafeInteger(lengthMillimetres) ||
    !Number.isSafeInteger(widthOrHeightMillimetres) ||
    lengthMillimetres <= 0 ||
    widthOrHeightMillimetres <= 0
  ) {
    throw new Error('Dimensions must be positive integer millimetres.');
  }

  if (
    !Number.isFinite(coverageSquareMetresPerUnit) ||
    coverageSquareMetresPerUnit <= 0
  ) {
    throw new Error('Coverage must be a positive number.');
  }

  if (
    !Number.isInteger(wastageBasisPoints) ||
    wastageBasisPoints < 0 ||
    wastageBasisPoints > 10000
  ) {
    throw new Error('Wastage basis points must be between 0 and 10,000.');
  }

  if (!Number.isSafeInteger(unitPriceKobo) || unitPriceKobo < 0) {
    throw new Error('Unit price must be non-negative integer kobo.');
  }

  const areaSquareMillimetres =
    lengthMillimetres * widthOrHeightMillimetres;
  const coverageSquareMillimetresPerUnit = Math.round(
    coverageSquareMetresPerUnit * 1_000_000,
  );
  const wastageAdjustedArea =
    areaSquareMillimetres * (10000 + wastageBasisPoints);
  const purchasableUnitDivisor =
    coverageSquareMillimetresPerUnit * 10000;

  if (
    !Number.isSafeInteger(areaSquareMillimetres) ||
    !Number.isSafeInteger(coverageSquareMillimetresPerUnit) ||
    !Number.isSafeInteger(wastageAdjustedArea) ||
    !Number.isSafeInteger(purchasableUnitDivisor)
  ) {
    throw new Error('Material calculation exceeds the safe numeric range.');
  }

  const rawUnits = wastageAdjustedArea / purchasableUnitDivisor;
  const purchasableUnits = Math.ceil(rawUnits);
  const estimatedCostKobo = purchasableUnits * unitPriceKobo;

  if (!Number.isSafeInteger(estimatedCostKobo)) {
    throw new Error('Estimated material cost exceeds the safe money range.');
  }

  return {
    areaSquareMetres: areaSquareMillimetres / 1_000_000,
    rawUnits,
    purchasableUnits,
    estimatedCostKobo,
  };
}
