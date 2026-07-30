import { describe, expect, it } from 'vitest';

import { calculatePodDeposit } from '@/lib/utils/money/calculatePodDeposit';
import { formatMoney } from '@/lib/utils/money/formatMoney';

describe('money utilities', () => {
  it('formats integer kobo as Nigerian Naira', () => {
    expect(formatMoney(2500000)).toContain('25,000');
  });

  it('does not require a deposit exactly at the POD threshold', () => {
    expect(
      calculatePodDeposit({
        grandTotalKobo: 5000000,
        thresholdKobo: 5000000,
        depositBasisPoints: 3000,
      }),
    ).toBe(0);
  });

  it('rounds a required deposit up to the next whole kobo', () => {
    expect(
      calculatePodDeposit({
        grandTotalKobo: 5000001,
        thresholdKobo: 5000000,
        depositBasisPoints: 3000,
      }),
    ).toBe(1500001);
  });
});
