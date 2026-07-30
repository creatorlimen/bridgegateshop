import { describe, expect, it } from 'vitest';

import { getPermissionsForRoles } from '@/lib/auth/roles';

describe('role permissions', () => {
  it('keeps customer accounts unprivileged', () => {
    expect([...getPermissionsForRoles(['customer'])]).toEqual([]);
  });

  it('combines permissions without duplicates', () => {
    const resolvedPermissions = getPermissionsForRoles([
      'supportAgent',
      'fulfilmentStaff',
    ]);

    expect(resolvedPermissions.has('orders.read')).toBe(true);
    expect(resolvedPermissions.has('inventory.adjust')).toBe(true);
    expect(resolvedPermissions.size).toBe(10);
  });

  it('grants the owner every declared permission', async () => {
    const { permissions } = await import('@/lib/auth/permissions');
    const ownerPermissions = getPermissionsForRoles(['owner']);

    expect(ownerPermissions.size).toBe(permissions.length);
    expect([...ownerPermissions]).toEqual(expect.arrayContaining([...permissions]));
  });
});
