import 'server-only';

import { z } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase/admin';

const userProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.string().email(),
  emailNormalised: z.string().email(),
  phoneE164: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .nullable(),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  accountStatus: z.enum(['active', 'restricted', 'disabled']),
  companyName: z.string().trim().min(1).max(160).nullable(),
  preferredChannels: z.record(z.boolean()).default({}),
  marketingConsentSummary: z.record(z.unknown()).default({}),
  mergedGuestCartIds: z.array(z.string().min(1)).max(50).default([]),
});

export type UserProfile = z.infer<typeof userProfileSchema> & {
  uid: string;
};

export async function getUserProfileByUid(
  uid: string,
): Promise<UserProfile | null> {
  const snapshot = await getFirebaseAdminFirestore()
    .collection('userProfiles')
    .doc(uid)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  const parsedProfile = userProfileSchema.safeParse(snapshot.data());

  if (!parsedProfile.success) {
    throw new Error(`User profile ${uid} is invalid.`, {
      cause: parsedProfile.error,
    });
  }

  return {
    uid,
    ...parsedProfile.data,
  };
}
