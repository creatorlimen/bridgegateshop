import { z } from 'zod';

export type FirestoreTimestampValue =
  | Date
  | {
      toDate: () => Date;
      toMillis: () => number;
    };

export const actorReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}|system:[a-z][a-z0-9.-]{0,119})$/,
    'Actor references must be a Firebase UID or a system service reference.',
  );

export const firestoreDocumentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^(?!\.{1,2}$)(?!__.*__$)[^/]+$/,
    'Firestore document IDs cannot contain path separators or reserved names.',
  );

export const firestoreTimestampSchema = z.custom<FirestoreTimestampValue>(
  (value) => {
    if (value instanceof Date) {
      return !Number.isNaN(value.getTime());
    }

    if (!value || typeof value !== 'object') {
      return false;
    }

    const timestampCandidate = value as {
      toDate?: unknown;
      toMillis?: unknown;
    };

    return (
      typeof timestampCandidate.toDate === 'function' &&
      typeof timestampCandidate.toMillis === 'function'
    );
  },
  'A valid Firestore timestamp is required.',
);

export const mutableRecordFieldsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  createdAt: firestoreTimestampSchema,
  createdBy: actorReferenceSchema,
  updatedAt: firestoreTimestampSchema,
  updatedBy: actorReferenceSchema,
  version: z.number().int().positive(),
});

export const softArchiveFieldsSchema = z.object({
  archivedAt: firestoreTimestampSchema.nullable(),
  archivedBy: actorReferenceSchema.nullable(),
  archiveReason: z.string().trim().min(1).max(500).nullable(),
});

export function firestoreTimestampToDate(
  timestamp: FirestoreTimestampValue,
): Date {
  return timestamp instanceof Date ? timestamp : timestamp.toDate();
}
