import { describe, expect, it } from 'vitest';

import { calculateMaterials } from '@/lib/utils/calculator/calculateMaterials';

describe('material calculator', () => {
  it('applies wastage and rounds up to purchasable units', () => {
    const calculationResult = calculateMaterials({
      lengthMillimetres: 5000,
      widthOrHeightMillimetres: 3000,
      coverageSquareMetresPerUnit: 10,
      wastageBasisPoints: 1000,
      unitPriceKobo: 2000000,
    });

    expect(calculationResult).toMatchObject({
      areaSquareMetres: 15,
      purchasableUnits: 2,
      estimatedCostKobo: 4000000,
    });
    expect(calculationResult.rawUnits).toBeCloseTo(1.65);
  });

  it('rejects zero dimensions', () => {
    expect(() =>
      calculateMaterials({
        lengthMillimetres: 0,
        widthOrHeightMillimetres: 3000,
        coverageSquareMetresPerUnit: 10,
        wastageBasisPoints: 1000,
        unitPriceKobo: 2000000,
      }),
    ).toThrow('Dimensions must be positive integer millimetres.');
  });
});
