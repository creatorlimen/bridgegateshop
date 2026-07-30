import { describe, expect, it } from 'vitest';

import {
  calculateProductStockState,
  calculateStockState,
} from '@/lib/utils/inventory/calculateStockState';

describe('inventory stock-state calculation', () => {
  it('derives managed and unmanaged variant availability', () => {
    expect(
      calculateStockState({
        stockManaged: false,
        available: 0,
        lowStockThreshold: 5,
      }),
    ).toBe('notManaged');
    expect(
      calculateStockState({
        stockManaged: true,
        available: 0,
        lowStockThreshold: 5,
      }),
    ).toBe('outOfStock');
    expect(
      calculateStockState({
        stockManaged: true,
        available: 5,
        lowStockThreshold: 5,
      }),
    ).toBe('lowStock');
    expect(
      calculateStockState({
        stockManaged: true,
        available: 6,
        lowStockThreshold: 5,
      }),
    ).toBe('inStock');
  });

  it('derives a product projection from all active variants', () => {
    expect(calculateProductStockState([])).toBe('outOfStock');
    expect(
      calculateProductStockState(['outOfStock', 'lowStock']),
    ).toBe('lowStock');
    expect(
      calculateProductStockState(['outOfStock', 'inStock']),
    ).toBe('inStock');
    expect(
      calculateProductStockState(['outOfStock', 'notManaged']),
    ).toBe('notManaged');
  });
});
