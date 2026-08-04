import type { Metadata } from 'next';

import {
  updateBusinessCalendarAction,
  updateDeliveryZoneAction,
  updateFulfilmentSettingsAction,
} from '@/app/admin/settings/fulfilment/actions';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { loadFulfilmentSettings } from '@/lib/config/fulfilmentSettings';
import { createFulfilmentSettingsService } from '@/lib/services/settings/FulfilmentSettingsService';

export const metadata: Metadata = { title: 'Fulfilment settings', robots: { index: false, follow: false } };
const field = 'min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm';
const section = 'grid gap-4 rounded-2xl border border-ink/10 bg-paper p-6 sm:grid-cols-2';

type PageProps = { searchParams: Promise<{ notice?: string }> };

export default async function FulfilmentSettingsPage({ searchParams }: PageProps) {
  await requireStaffPermission('settings.commerce.write');
  const service = createFulfilmentSettingsService();
  const [runtime, stored, zoneRecords, calendarRecords, query] = await Promise.all([
    loadFulfilmentSettings(),
    service.getRecord(),
    service.listZoneRecords(),
    service.listCalendarRecords(),
    searchParams,
  ]);
  const zoneVersions = new Map(zoneRecords.map((zone) => [zone.id, zone.version]));
  return (
    <section>
      <p className="eyebrow">Versioned configuration</p>
      <h1 className="display-type mt-4 text-5xl">Fulfilment settings</h1>
      <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">Every saved change advances the configuration version. Existing orders retain their accepted zone, fee, calendar estimate, and pickup snapshot.</p>
      {query.notice ? <p className="mt-5 rounded-xl bg-amber/20 p-4 text-sm font-bold">{query.notice}</p> : null}

      <form action={updateFulfilmentSettingsAction} className="mt-8 grid gap-5">
        <input name="expectedVersion" type="hidden" value={stored?.version ?? 0} />
        <fieldset className={section}>
          <legend className="px-2 font-black">Pickup and support</legend>
          <label><input defaultChecked={runtime.pickup.enabled} name="pickupEnabled" type="checkbox" /> <strong>Pickup enabled</strong></label>
          <label><input defaultChecked={runtime.pickup.sameDayEnabled} name="pickupSameDayEnabled" type="checkbox" /> Same-day pickup enabled</label>
          <TextField label="Pickup label" name="pickupLabel" value={runtime.pickup.label} />
          <TextField label="Cut-off (Lagos time)" name="pickupCutoff" type="time" value={runtime.pickup.cutoffLocalTime} />
          <TextArea label="Approved pickup address" name="pickupAddress" value={runtime.pickup.address} />
          <TextArea label="Opening hours" name="pickupOpeningHours" value={runtime.pickup.openingHours} />
          <TextField label="Service days (0 Sundayâ€“6 Saturday)" name="pickupServiceDays" value={runtime.pickup.serviceDays.join(',')} />
          <TextField label="Minimum preparation days" name="pickupMinimumDays" type="number" value={String(runtime.pickup.minimumPreparationBusinessDays)} />
          <TextField label="Maximum preparation days" name="pickupMaximumDays" type="number" value={String(runtime.pickup.maximumPreparationBusinessDays)} />
          <TextField label="WhatsApp phone (234â€¦; optional)" name="supportWhatsappPhone" required={false} value={runtime.supportWhatsappPhone ?? ''} />
        </fieldset>
        <fieldset className={section}>
          <legend className="px-2 font-black">Public tracking limits</legend>
          <TextField label="Window minutes" name="trackingWindowMinutes" type="number" value={String(runtime.trackingRateLimit.windowMinutes)} />
          <TextField label="Maximum per IP" name="trackingMaximumPerIp" type="number" value={String(runtime.trackingRateLimit.maximumAttemptsPerIp)} />
          <TextField label="Maximum per reference" name="trackingMaximumPerReference" type="number" value={String(runtime.trackingRateLimit.maximumAttemptsPerReference)} />
          <TextField label="Maximum per contact factor" name="trackingMaximumPerFactor" type="number" value={String(runtime.trackingRateLimit.maximumAttemptsPerFactor)} />
        </fieldset>
        <button className="w-fit rounded-full bg-ink px-6 py-3 text-sm font-black text-paper" type="submit">Save global settings</button>
      </form>

      <div className="mt-12 grid gap-6">
        <h2 className="display-type text-4xl">Delivery zones</h2>
        {runtime.deliveryZones.map((zone) => (
          <form action={updateDeliveryZoneAction} className={section} key={zone.id}>
            <input name="zoneId" type="hidden" value={zone.id} /><input name="expectedVersion" type="hidden" value={zoneVersions.get(zone.id) ?? 0} /><input name="expectedSettingsVersion" type="hidden" value={stored?.version ?? 0} />
            <h3 className="text-xl font-black sm:col-span-2">{zone.name}</h3>
            <label><input defaultChecked={zone.active} name="active" type="checkbox" /> Active</label>
            <label><input defaultChecked={zone.deliveryEnabled} name="deliveryEnabled" type="checkbox" /> Delivery enabled</label>
            <label><input defaultChecked={zone.sameDayEnabled} name="sameDayEnabled" type="checkbox" /> Same-day enabled</label>
            <label><input defaultChecked={zone.podEligible} name="podEligible" type="checkbox" /> POD eligible</label>
            <TextField label="Name" name="name" value={zone.name} />
            <TextField label="Fee (NGN)" name="feeNaira" value={(zone.feeKobo / 100).toFixed(2)} />
            <TextField label="Service days" name="serviceDays" value={zone.serviceDays.join(',')} />
            <TextField label="Cut-off (Lagos time)" name="cutoffLocalTime" type="time" value={zone.cutoffLocalTime} />
            <TextField label="Minimum business days" name="minimumBusinessDays" type="number" value={String(zone.minimumBusinessDays)} />
            <TextField label="Maximum business days" name="maximumBusinessDays" type="number" value={String(zone.maximumBusinessDays)} />
            <TextField label="Priority" name="priority" type="number" value={String(zone.priority)} />
            <TextArea label="Display copy" name="displayCopy" value={zone.displayCopy} />
            <TextArea label="Area hints (one per line)" name="areaHints" value={zone.areaHints.join('\n')} />
            <TextArea label="Postcode hints (one per line)" name="postcodeHints" value={zone.postcodeHints.join('\n')} />
            <button className="w-fit rounded-full bg-ink px-5 py-3 text-xs font-black text-paper sm:col-span-2" type="submit">Save zone</button>
          </form>
        ))}
      </div>

      <div className="mt-12 grid gap-6">
        <h2 className="display-type text-4xl">Business calendar</h2>
        {calendarRecords.map((record) => <CalendarForm calendar={record} key={record.id} settingsVersion={stored?.version ?? 0} zones={runtime.deliveryZones} />)}
        <CalendarForm calendar={null} settingsVersion={stored?.version ?? 0} zones={runtime.deliveryZones} />
      </div>
    </section>
  );
}

function TextField({ label, name, value, required = true, type = 'text' }: { label: string; name: string; value: string; required?: boolean; type?: string }) {
  return <label className="grid gap-2 text-sm font-bold">{label}<input className={field} defaultValue={value} name={name} required={required} type={type} /></label>;
}
function TextArea({ label, name, value }: { label: string; name: string; value: string }) {
  return <label className="grid gap-2 text-sm font-bold">{label}<textarea className={`${field} min-h-24 py-3`} defaultValue={value} name={name} /></label>;
}
function CalendarForm({ calendar, settingsVersion, zones }: { calendar: { date: string; name: string; open: boolean; affectedZoneIds: string[]; note: string | null; version: number } | null; settingsVersion: number; zones: ReadonlyArray<{ id: string; name: string }> }) {
  return <form action={updateBusinessCalendarAction} className={section}><input name="expectedVersion" type="hidden" value={calendar?.version ?? 0} /><input name="expectedSettingsVersion" type="hidden" value={settingsVersion} /><TextField label="Date" name="date" type="date" value={calendar?.date ?? ''} /><TextField label="Name" name="name" value={calendar?.name ?? ''} /><label><input defaultChecked={calendar?.open ?? false} name="open" type="checkbox" /> Open despite normal calendar</label><div className="grid gap-2 text-sm"><strong>Affected zones (none means all)</strong>{zones.map((zone) => <label key={zone.id}><input defaultChecked={calendar?.affectedZoneIds.includes(zone.id)} name="affectedZoneIds" type="checkbox" value={zone.id} /> {zone.name}</label>)}</div><TextArea label="Operational note" name="note" value={calendar?.note ?? ''} /><button className="w-fit rounded-full bg-ink px-5 py-3 text-xs font-black text-paper" type="submit">{calendar ? 'Update calendar date' : 'Add calendar date'}</button></form>;
}

