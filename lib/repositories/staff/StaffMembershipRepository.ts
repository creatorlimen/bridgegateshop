import 'server-only';

import { z } from 'zod';

import { permissions } from '@/lib/auth/permissions';
import { roles } from '@/lib/auth/roles';
import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';

const staffMembershipSchema = z.object({
  displayName: z.string().trim().min(1).max(120).nullable().default(null),
  email: z.string().email().nullable().default(null),
  roleIds: z.array(z.enum(roles)).min(1),
  permissionOverrides: z
    .object({
      grants: z.array(z.enum(permissions)).default([]),
      revocations: z.array(z.enum(permissions)).default([]),
      reason: z.string().trim().min(1).max(500).nullable().default(null),
    })
    .default({
      grants: [],
      revocations: [],
      reason: null,
    }),
  permissionRevision: z.number().int().nonnegative().default(0),
  mfaStatus: z
    .enum(['notEnrolled', 'enrolled', 'required'])
    .default('notEnrolled'),
  status: z.enum(['invited', 'active', 'suspended', 'revoked']),
});

export type StaffMembership = z.infer<typeof staffMembershipSchema> & {
  uid: string;
};

export class StaffMembershipDataError extends Error {
  constructor(uid: string, options?: ErrorOptions) {
    super(`Staff membership ${uid} is invalid.`, options);
    this.name = 'StaffMembershipDataError';
  }
}

export async function getStaffMembershipByUid(
  uid: string,
): Promise<StaffMembership | null> {
  const snapshot = await getFirebaseAdminFirestore()
    .collection('staffMemberships')
    .doc(uid)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  const parsedMembership = staffMembershipSchema.safeParse(snapshot.data());

  if (!parsedMembership.success) {
    throw new StaffMembershipDataError(uid, {
      cause: parsedMembership.error,
    });
  }

  return {
    uid,
    ...parsedMembership.data,
  };
}
