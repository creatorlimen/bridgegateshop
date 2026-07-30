export type InventoryStockState =
  | 'inStock'
  | 'lowStock'
  | 'outOfStock'
  | 'notManaged';

type CalculateStockStateInput = {
  stockManaged: boolean;
  available: number;
  lowStockThreshold: number;
};

export function calculateStockState({
  stockManaged,
  available,
  lowStockThreshold,
}: CalculateStockStateInput): InventoryStockState {
  if (!stockManaged) {
    return 'notManaged';
  }

  if (available <= 0) {
    return 'outOfStock';
  }

  return available <= lowStockThreshold ? 'lowStock' : 'inStock';
}

export function calculateProductStockState(
  variantStates: readonly InventoryStockState[],
): InventoryStockState {
  if (variantStates.length === 0) {
    return 'outOfStock';
  }

  if (variantStates.includes('notManaged')) {
    return 'notManaged';
  }

  if (variantStates.includes('inStock')) {
    return 'inStock';
  }

  if (variantStates.includes('lowStock')) {
    return 'lowStock';
  }

  return 'outOfStock';
}
