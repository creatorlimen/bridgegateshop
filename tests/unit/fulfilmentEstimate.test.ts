import { describe, expect, it } from 'vitest';

import { calculateDeliveryEstimate } from '@/lib/utils/fulfilment/calculateDeliveryEstimate';

const schedule = {
  serviceDays: [1, 2, 3, 4, 5, 6],
  cutoffLocalTime: '12:00',
  sameDayEnabled: true,
  minimumBusinessDays: 1,
  maximumBusinessDays: 2,
};

function estimate(now: string, overrides: Partial<Parameters<typeof calculateDeliveryEstimate>[0]> = {}) {
  return calculateDeliveryEstimate({
    now: new Date(now),
    configurationVersion: 'fulfilment-test-v1',
    method: 'delivery',
    zoneId: 'lagos-mainland',
    schedule,
    closures: [],
    stockImmediatelyAvailable: true,
    ...overrides,
  });
}

describe('Lagos fulfilment estimates', () => {
  it('qualifies immediately available stock strictly before the local cut-off', () => {
    const result = estimate('2026-08-03T10:59:00.000Z');

    expect(result).toMatchObject({
      localPlacementDate: '2026-08-03',
      earliestDate: '2026-08-03',
      sameDayQualified: true,
    });
  });

  it('does not qualify an order placed exactly at the local cut-off', () => {
    const result = estimate('2026-08-03T11:00:00.000Z');

    expect(result).toMatchObject({
      localPlacementDate: '2026-08-03',
      earliestDate: '2026-08-05',
      sameDayQualified: false,
    });
    expect(result.assumptions).toContain('Placed at or after the local cut-off');
  });

  it('skips Sundays and a zone-specific closure', () => {
    const result = estimate('2026-08-08T12:30:00.000Z', {
      closures: [
        {
          date: '2026-08-10',
          open: false,
          affectedZoneIds: ['lagos-mainland'],
        },
      ],
    });

    expect(result.earliestDate).toBe('2026-08-12');
    expect(result.latestDate).toBe('2026-08-13');
  });

  it('disables same-day qualification when stock is not immediately available', () => {
    const result = estimate('2026-08-03T09:00:00.000Z', {
      stockImmediatelyAvailable: false,
    });

    expect(result.sameDayQualified).toBe(false);
    expect(result.earliestDate).toBe('2026-08-04');
  });
});
