import 'server-only';

import type { Permission } from '@/lib/auth/permissions';
import { getPermissionsForRoles } from '@/lib/auth/roles';
import {
  getCurrentSession,
  type AuthenticatedSession,
} from '@/lib/auth/session';
import {
  getStaffMembershipByUid,
  type StaffMembership,
} from '@/lib/repositories/staff/StaffMembershipRepository';

export type ActiveStaffContext = {
  session: AuthenticatedSession;
  membership: StaffMembership & { status: 'active' };
  permissions: ReadonlySet<Permission>;
};

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication is required.');
    this.name = 'AuthenticationRequiredError';
  }
}

export class StaffAccessRequiredError extends Error {
  constructor() {
    super('An active staff membership is required.');
    this.name = 'StaffAccessRequiredError';
  }
}

export class PermissionRequiredError extends Error {
  constructor(permission: Permission) {
    super(`Permission ${permission} is required.`);
    this.name = 'PermissionRequiredError';
  }
}

export async function getActiveStaffContext(): Promise<ActiveStaffContext | null> {
  const session = await getCurrentSession({ checkRevoked: true });

  if (!session) {
    return null;
  }

  const membership = await getStaffMembershipByUid(session.uid);

  if (!membership || membership.status !== 'active') {
    return null;
  }

  const resolvedPermissions = getPermissionsForRoles(membership.roleIds);

  for (const permission of membership.permissionOverrides.grants) {
    resolvedPermissions.add(permission);
  }

  for (const permission of membership.permissionOverrides.revocations) {
    resolvedPermissions.delete(permission);
  }

  return {
    session,
    membership: {
      ...membership,
      status: 'active',
    },
    permissions: resolvedPermissions,
  };
}

export async function requireStaffPermission(
  permission: Permission,
): Promise<ActiveStaffContext> {
  const context = await getActiveStaffContext();

  if (!context) {
    throw new StaffAccessRequiredError();
  }

  if (!context.permissions.has(permission)) {
    throw new PermissionRequiredError(permission);
  }

  return context;
}
