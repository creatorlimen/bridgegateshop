import Image from 'next/image';
import Link from 'next/link';

import { createCheckoutOrderAction } from '@/app/actions/checkout';
import type { CheckoutSettings } from '@/lib/config/checkoutSettings';
import type { CurrentCart } from '@/lib/services/carts/authoritativeCart';
import { formatMoney } from '@/lib/utils/money/formatMoney';

type CheckoutOrderFormProps = {
  cart: CurrentCart;
  checkoutSettings: CheckoutSettings;
  errorMessage?: string;
  idempotencyKey: string;
};

export function CheckoutOrderForm({
  cart,
  checkoutSettings,
  errorMessage,
  idempotencyKey,
}: CheckoutOrderFormProps) {
  const deliveryZones = checkoutSettings.deliveryZones.filter(
    (zone) => zone.active && zone.deliveryEnabled,
  );
  const deliveryAvailable = deliveryZones.length > 0;
  const pickupAvailable = checkoutSettings.pickup.enabled;
  const defaultFulfilmentMethod = deliveryAvailable ? 'delivery' : pickupAvailable ? 'pickup' : null;
  const defaultPaymentMethod = (
    ['paystack', 'pod', 'manualTransfer'] as const
  ).find((method) => checkoutSettings.paymentMethods[method].enabled);
  const canSubmit =
    cart.readyForCheckout &&
    cart.dataSource === 'firestore' &&
    cart.id !== null &&
    cart.version !== null &&
    Boolean(defaultFulfilmentMethod) &&
    Boolean(defaultPaymentMethod);

  return (
    <>
      {errorMessage ? (
        <div className="mb-8 rounded-2xl border border-clay/20 bg-clay/10 p-5 text-sm" role="alert">
          <p className="font-black">{errorMessage}</p>
        </div>
      ) : null}

      <form action={createCheckoutOrderAction} className="grid gap-8 lg:grid-cols-[1fr_23rem]">
        <input name="cartId" type="hidden" value={cart.id ?? ''} />
        <input name="cartVersion" type="hidden" value={cart.version ?? 0} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />

        <div className="grid gap-5">
          <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6 sm:p-8">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-clay">Step 1</p>
            <h2 className="mt-2 text-xl font-black">Contact and fulfilment</h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <Field label="Full name" name="fullName" required />
              <Field label="Nigerian phone number" name="phone" placeholder="+234..." required type="tel" />
              <Field className="sm:col-span-2" label="Email address" name="email" required type="email" />
              <Field className="sm:col-span-2" label="Company name (optional)" name="company" />
            </div>

            <fieldset className="mt-7">
              <legend className="text-sm font-black">Fulfilment method</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Choice defaultChecked={defaultFulfilmentMethod === 'delivery'} description="Zone and fee are resolved again by the server." disabled={!deliveryAvailable} label="Lagos delivery" name="fulfilment" value="delivery" />
                <Choice defaultChecked={defaultFulfilmentMethod === 'pickup'} description="No delivery fee; pickup details are snapshotted with the order." disabled={!pickupAvailable} label="Store pickup" name="fulfilment" value="pickup" />
              </div>
            </fieldset>

            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold sm:col-span-2">
                Delivery zone
                <select className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal" defaultValue={deliveryZones[0]?.id} disabled={!deliveryAvailable} name="deliveryZoneId">
                  {deliveryZones.map((zone) => (
                    <option key={zone.id} value={zone.id}>{zone.name} · {formatMoney(zone.feeKobo)}</option>
                  ))}
                </select>
              </label>
              <Field className="sm:col-span-2" label="Delivery address" name="addressLine1" />
              <Field label="Address line 2 (optional)" name="addressLine2" />
              <Field label="Landmark (optional)" name="landmark" />
              <Field label="City" name="city" value="Lagos" />
              <label className="grid gap-2 text-sm font-bold sm:col-span-2">
                Order note (optional)
                <textarea className="min-h-24 rounded-xl border border-ink/15 bg-canvas px-4 py-3 font-normal" maxLength={1000} name="customerNote" />
              </label>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">Delivery fields are ignored when store pickup is selected. Delivery submissions are rejected server-side if the address is incomplete.</p>
          </section>

          <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6 sm:p-8">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-clay">Step 2</p>
            <h2 className="mt-2 text-xl font-black">Payment and consent</h2>
            <div className="mt-6 grid gap-3">
              {([
                ['paystack', 'Card, bank, USSD, or another method enabled on Specta’s Paystack account.'],
                ['pod', 'Eligibility is checked from the delivery zone, order value, customer, and selected products.'],
                ['manualTransfer', 'Your stock is held until an authorised team member verifies the transfer.'],
              ] as const).map(([value, description]) => {
                const setting = checkoutSettings.paymentMethods[value];
                return (
                  <Choice
                    defaultChecked={value === defaultPaymentMethod}
                    description={setting.unavailableReason ?? description}
                    disabled={!setting.enabled}
                    key={value}
                    label={setting.customerLabel}
                    name="payment"
                    value={value}
                  />
                );
              })}
            </div>
            <div className="mt-7 grid gap-4 border-t border-ink/10 pt-6">
              <Consent name="termsAccepted">I accept the current terms and conditions. The published version is stored with the order.</Consent>
              <Consent name="privacyAccepted">I acknowledge the privacy notice for processing this order.</Consent>
            </div>
          </section>
        </div>

        <aside className="h-fit rounded-[1.75rem] bg-ink p-6 text-white sm:p-7 lg:sticky lg:top-28">
          <p className="text-xs font-black uppercase tracking-[0.15em] text-amber">Order review</p>
          <div className="mt-6 grid gap-4">
            {cart.lines.map((line) => (
              <div className="flex gap-3" key={line.variantId}>
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10">
                  <Image alt="" className="object-cover" fill sizes="56px" src={line.imagePath} />
                </div>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-black">{line.productName}</p><p className="mt-1 text-[0.68rem] text-white/45">{line.requestedQuantity} × {line.variantName}</p></div>
                <p className="text-xs font-black">{formatMoney(line.lineTotalKobo)}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-end justify-between border-t border-white/15 pt-6"><p className="text-sm text-white/60">Items subtotal</p><p className="text-2xl font-black">{formatMoney(cart.subtotalKobo)}</p></div>
          <p className="mt-2 text-[0.68rem] text-white/45">The authoritative delivery fee and grand total are calculated during order creation.</p>
          <button className="mt-6 min-h-14 w-full rounded-full bg-amber px-5 text-sm font-black text-ink disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-white/45" disabled={!canSubmit} type="submit">
            {cart.dataSource !== 'firestore' ? 'Firestore checkout is not configured' : defaultPaymentMethod ? 'Place order securely' : 'No payment method is configured'}
          </button>
          {!cart.readyForCheckout ? <Link className="mt-5 inline-flex text-xs font-black underline" href="/cart">Return to cart to resolve changes</Link> : null}
          <p className="mt-4 text-[0.68rem] leading-5 text-white/45">The server recalculates every amount, checks method eligibility, and creates the order plus stock hold atomically. Payment is posted only after method-specific verification.</p>
        </aside>
      </form>
    </>
  );
}

function Field({ className = '', label, name, placeholder, required = false, type = 'text', value }: { className?: string; label: string; name: string; placeholder?: string; required?: boolean; type?: string; value?: string }) {
  return <label className={`grid gap-2 text-sm font-bold ${className}`}>{label}<input className="min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 font-normal outline-none focus:border-ink" defaultValue={value} maxLength={320} name={name} placeholder={placeholder} required={required} type={type} /></label>;
}

function Choice({ defaultChecked = false, description, disabled = false, label, name, value }: { defaultChecked?: boolean; description: string; disabled?: boolean; label: string; name: string; value: string }) {
  return <label className="rounded-2xl border border-ink/15 p-4 has-[:checked]:border-ink has-[:checked]:ring-2 has-[:checked]:ring-amber"><input className="mr-3" defaultChecked={defaultChecked} disabled={disabled} name={name} type="radio" value={value} /><span className="text-sm font-black">{label}</span><span className="mt-2 block pl-6 text-xs leading-5 text-muted">{description}</span></label>;
}

function Consent({ children, name }: { children: React.ReactNode; name: string }) {
  return <label className="flex gap-3 text-sm leading-6"><input name={name} required type="checkbox" /><span>{children}</span></label>;
}

