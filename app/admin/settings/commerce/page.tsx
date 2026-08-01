import type { Metadata } from 'next';

import { updateCommercePaymentSettingsAction } from '@/app/admin/settings/commerce/actions';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { getCheckoutSettings } from '@/lib/config/checkoutSettings';
import { createCommercePaymentSettingsService } from '@/lib/services/settings/CommercePaymentSettingsService';

export const metadata: Metadata = {
  title: 'Commerce payment settings',
  robots: { index: false, follow: false },
};

type PageProps = { searchParams: Promise<{ notice?: string }> };
const field = 'min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm';

export default async function CommerceSettingsPage({ searchParams }: PageProps) {
  await requireStaffPermission('settings.commerce.write');
  const [stored, query] = await Promise.all([
    createCommercePaymentSettingsService().getRecord(),
    searchParams,
  ]);
  const fallback = getCheckoutSettings();
  const pod = stored?.pod ?? fallback.pod;
  const transfer = stored?.manualTransfer ?? fallback.manualTransfer;
  const business = stored?.financialDocuments ?? fallback.financialDocuments;

  return (
    <section>
      <p className="eyebrow">Versioned configuration</p>
      <h1 className="display-type mt-4 text-5xl">Commerce payments</h1>
      <p className="mt-5 max-w-3xl text-sm text-muted">POD and transfer stay disabled until approved values are deliberately saved. Each order snapshots the configuration version it used.</p>
      {query.notice ? <p className="mt-5 rounded-xl bg-amber/20 p-4 text-sm font-bold">{query.notice}</p> : null}
      <form action={updateCommercePaymentSettingsAction} className="mt-8 grid gap-6">
        <input name="expectedVersion" type="hidden" value={stored?.version ?? 0} />
        <fieldset className="grid gap-4 rounded-2xl border border-ink/10 bg-paper p-6 sm:grid-cols-2">
          <legend className="px-2 font-black">Pay on Delivery</legend>
          <label className="sm:col-span-2"><input defaultChecked={pod.enabled} name="podEnabled" type="checkbox" /> <strong>Enable only after approval</strong></label>
          {fallback.deliveryZones.map((zone) => <label key={zone.id}><input defaultChecked={pod.allowedZoneIds.includes(zone.id)} name="podAllowedZoneIds" type="checkbox" value={zone.id} /> {zone.name}</label>)}
          <MoneyField defaultValue={pod.minimumOrderKobo} label="Minimum order (NGN)" name="podMinimumNaira" />
          <MoneyField defaultValue={pod.maximumOrderKobo} label="Maximum order (NGN)" name="podMaximumNaira" />
          <MoneyField defaultValue={pod.depositThresholdKobo} label="Deposit threshold (NGN)" name="podDepositThresholdNaira" />
          <TextField defaultValue={(pod.depositBasisPoints / 100).toString()} label="Deposit percent" name="podDepositPercent" />
          <TextField defaultValue={pod.holdMinutes.toString()} label="Approval hold minutes" name="podHoldMinutes" />
          <TextArea defaultValue={pod.excludedProductIds.join('\n')} label="Excluded product IDs" name="podExcludedProductIds" />
          <TextArea defaultValue={pod.excludedVariantIds.join('\n')} label="Excluded variant IDs" name="podExcludedVariantIds" />
          <TextArea defaultValue={pod.restrictedOwnerUids.join('\n')} label="Restricted customer UIDs" name="podRestrictedOwnerUids" />
          <TextArea defaultValue={pod.restrictedEmails.join('\n')} label="Restricted emails" name="podRestrictedEmails" />
        </fieldset>

        <fieldset className="grid gap-4 rounded-2xl border border-ink/10 bg-paper p-6 sm:grid-cols-2">
          <legend className="px-2 font-black">Manual Bank Transfer</legend>
          <label><input defaultChecked={transfer.enabled} name="manualTransferEnabled" type="checkbox" /> <strong>Enable only after approval</strong></label>
          <label><input defaultChecked={transfer.allowPartialPayments} name="manualTransferAllowPartial" type="checkbox" /> Allow partial verification</label>
          <label><input defaultChecked={transfer.evidenceUploadEnabled} name="manualTransferEvidenceEnabled" type="checkbox" /> Enable private evidence</label>
          <TextField defaultValue={transfer.holdHours.toString()} label="Reservation hours" name="manualTransferHoldHours" />
          <TextField defaultValue={transfer.evidenceRetentionDays.toString()} label="Evidence retention days" name="evidenceRetentionDays" />
          <TextField defaultValue={transfer.instructionsVersion} label="Instructions version" name="instructionsVersion" />
          <TextField defaultValue={transfer.instructions.bankName} label="Bank name" name="bankName" />
          <TextField defaultValue={transfer.instructions.accountName} label="Account name" name="accountName" />
          <TextField defaultValue={transfer.instructions.accountNumber} label="Account number" name="accountNumber" />
          <TextArea defaultValue={transfer.instructions.customerMessage} label="Customer message" name="transferCustomerMessage" />
        </fieldset>

        <fieldset className="grid gap-4 rounded-2xl border border-ink/10 bg-paper p-6 sm:grid-cols-2">
          <legend className="px-2 font-black">Financial document identity</legend>
          <TextField defaultValue={business.businessName} label="Business name" name="businessName" />
          <TextField defaultValue={business.businessEmail} label="Business email" name="businessEmail" />
          <TextField defaultValue={business.businessPhone} label="Business phone" name="businessPhone" />
          <TextField defaultValue={business.registrationNumber ?? ''} label="Registration number" name="registrationNumber" required={false} />
          <TextField defaultValue={business.taxNumber ?? ''} label="Tax number" name="taxNumber" required={false} />
          <TextArea defaultValue={business.businessAddress} label="Business address" name="businessAddress" />
        </fieldset>
        <button className="w-fit rounded-full bg-ink px-6 py-3 text-sm font-black text-paper" type="submit">Save versioned settings</button>
      </form>
    </section>
  );
}

function TextField({ defaultValue, label, name, required = true }: { defaultValue: string; label: string; name: string; required?: boolean }) {
  return <label className="grid gap-2 text-sm font-bold">{label}<input className={field} defaultValue={defaultValue} name={name} required={required} /></label>;
}

function MoneyField({ defaultValue, label, name }: { defaultValue: number; label: string; name: string }) {
  return <TextField defaultValue={(defaultValue / 100).toFixed(2)} label={label} name={name} />;
}

function TextArea({ defaultValue, label, name }: { defaultValue: string; label: string; name: string }) {
  return <label className="grid gap-2 text-sm font-bold">{label}<textarea className={`${field} min-h-24 py-3`} defaultValue={defaultValue} name={name} /></label>;
}
