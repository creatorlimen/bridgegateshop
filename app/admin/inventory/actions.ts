'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  PermissionRequiredError,
  requireStaffPermission,
  StaffAccessRequiredError,
} from '@/lib/auth/authorization';
import { adjustInventoryInputSchema } from '@/lib/schemas/inventoryMutations';
import {
  createInventoryService,
  InventoryMutationError,
} from '@/lib/services/inventory/InventoryService';

function redirectToInventory(parameters: {
  notice?: string;
  error?: string;
  requestId?: string;
}): never {
  const searchParameters = new URLSearchParams();

  for (const [key, value] of Object.entries(parameters)) {
    if (value) {
      searchParameters.set(key, value);
    }
  }

  redirect(`/admin/inventory?${searchParameters.toString()}`);
}

export async function adjustInventoryFormAction(formData: FormData) {
  const requestId = randomUUID();

  try {
    const staffContext = await requireStaffPermission('inventory.adjust');
    const input = adjustInventoryInputSchema.parse({
      variantId: String(formData.get('variantId') ?? ''),
      expectedVersion: Number(formData.get('expectedVersion')),
      quantityDelta: Number(formData.get('quantityDelta')),
      movementType: String(formData.get('movementType') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
    });
    const result = await createInventoryService().adjustBalance(input, {
      actorId: staffContext.session.uid,
      roleIds: staffContext.membership.roleIds,
      requestId,
    });

    revalidatePath('/admin/inventory');
    revalidatePath('/shop');
    revalidatePath('/search');
    revalidatePath('/products/[slug]', 'page');
    redirectToInventory({
      notice: result.replay
        ? 'That adjustment was already applied safely.'
        : 'Inventory balance adjusted.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      redirectToInventory({
        error: 'Review the adjustment quantity, type, and reason.',
        requestId,
      });
    }

    if (error instanceof InventoryMutationError) {
      redirectToInventory({
        error: error.message,
        requestId,
      });
    }

    if (
      error instanceof StaffAccessRequiredError ||
      error instanceof PermissionRequiredError
    ) {
      redirectToInventory({
        error: 'Your staff session cannot adjust inventory.',
        requestId,
      });
    }

    redirectToInventory({
      error: 'The inventory adjustment could not be completed safely.',
      requestId,
    });
  }
}
