import { z } from 'zod';

export function normaliseNigerianPhoneNumber(value: string) {
  const compactValue = value.replace(/[\s()-]/g, '');

  if (/^0[789][01]\d{8}$/.test(compactValue)) {
    return `+234${compactValue.slice(1)}`;
  }

  if (/^234[789][01]\d{8}$/.test(compactValue)) {
    return `+${compactValue}`;
  }

  if (/^\+234[789][01]\d{8}$/.test(compactValue)) {
    return compactValue;
  }

  return null;
}

export const nigerianPhoneNumberSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, refinementContext) => {
    const normalisedValue = normaliseNigerianPhoneNumber(value);

    if (!normalisedValue) {
      refinementContext.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid Nigerian mobile phone number.',
      });
      return z.NEVER;
    }

    return normalisedValue;
  });

export const customerNameSchema = z.string().trim().min(2).max(160);

