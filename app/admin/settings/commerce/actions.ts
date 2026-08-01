'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireStaffPermission } from '@/lib/auth/authorization';
import { createCommercePaymentSettingsService } from '@/lib/services/settings/CommercePaymentSettingsService';
import { parseNairaToKobo } from '@/lib/utils/money/parseNairaToKobo';
import { parseNonnegativeNairaToKobo } from '@/lib/utils/money/parseNonnegativeNairaToKobo';

function required(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function optional(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(formData: FormData, name: string) {
  const value = Number(required(formData, name));
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

function list(formData: FormData, name: string) {
  return (optional(formData, name) ?? '')
    .split(/[\r\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function updateCommercePaymentSettingsAction(formData: FormData) {
  const context = await requireStaffPermission('settings.commerce.write');
  const depositPercent = Number(required(formData, 'podDepositPercent'));
  if (!Number.isFinite(depositPercent) || depositPercent < 0 || depositPercent > 100) {
    throw new Error('POD deposit percentage is invalid.');
  }
  await createCommercePaymentSettingsService().save(
    {
      expectedVersion: integer(formData, 'expectedVersion'),
      pod: {
        enabled: formData.get('podEnabled') === 'on',
        allowedZoneIds: formData.getAll('podAllowedZoneIds').map(String),
        excludedProductIds: list(formData, 'podExcludedProductIds'),
        excludedVariantIds: list(formData, 'podExcludedVariantIds'),
        restrictedOwnerUids: list(formData, 'podRestrictedOwnerUids'),
        restrictedEmails: list(formData, 'podRestrictedEmails').map((value) => value.toLowerCase()),
        minimumOrderKobo: parseNonnegativeNairaToKobo(required(formData, 'podMinimumNaira')),
        maximumOrderKobo: parseNairaToKobo(required(formData, 'podMaximumNaira')),
        depositThresholdKobo: parseNairaToKobo(required(formData, 'podDepositThresholdNaira')),
        depositBasisPoints: Math.round(depositPercent * 100),
        confirmationMode: 'staffApproval',
        holdMinutes: integer(formData, 'podHoldMinutes'),
      },
      manualTransfer: {
        enabled: formData.get('manualTransferEnabled') === 'on',
        holdHours: integer(formData, 'manualTransferHoldHours'),
        allowPartialPayments: formData.get('manualTransferAllowPartial') === 'on',
        evidenceUploadEnabled: formData.get('manualTransferEvidenceEnabled') === 'on',
        evidenceRetentionDays: integer(formData, 'evidenceRetentionDays'),
        instructionsVersion: required(formData, 'instructionsVersion'),
        instructions: {
          bankName: required(formData, 'bankName'),
          accountName: required(formData, 'accountName'),
          accountNumber: required(formData, 'accountNumber'),
          customerMessage: required(formData, 'transferCustomerMessage'),
        },
      },
      financialDocuments: {
        businessName: required(formData, 'businessName'),
        businessAddress: required(formData, 'businessAddress'),
        businessEmail: required(formData, 'businessEmail'),
        businessPhone: required(formData, 'businessPhone'),
        registrationNumber: optional(formData, 'registrationNumber'),
        taxNumber: optional(formData, 'taxNumber'),
      },
    },
    {
      actorId: context.session.uid,
      roleIds: context.membership.roleIds,
      requestId: randomUUID(),
    },
  );
  revalidatePath('/checkout');
  revalidatePath('/admin/settings/commerce');
  redirect('/admin/settings/commerce?notice=Payment%20settings%20updated');
}
