import type { Metadata } from 'next';

import {
  updateNotificationSettingsAction,
  updateNotificationTemplateAction,
} from '@/app/admin/settings/notifications/actions';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { getFallbackFulfilmentTemplate } from '@/lib/services/notifications/fulfilmentTemplates';
import { createNotificationSettingsService } from '@/lib/services/settings/NotificationSettingsService';

export const metadata: Metadata = { title: 'Notification settings', robots: { index: false, follow: false } };
const field = 'min-h-11 rounded-xl border border-ink/15 bg-canvas px-3 text-sm';
const statuses = ['preparing', 'readyForPickup', 'dispatched', 'outForDelivery', 'delivered', 'collected'] as const;

export default async function NotificationSettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireStaffPermission('settings.commerce.write');
  const service = createNotificationSettingsService();
  const [record, templates, query] = await Promise.all([service.getRecord(), service.listTemplates(), searchParams]);
  const settings = record ?? service.getDefaults();
  const health = service.getProviderConfigurationHealth();
  const templateMap = new Map(templates.map((template) => [`${template.fulfilmentStatus}:${template.channel}`, template]));
  return <section><p className="eyebrow">Transactional delivery</p><h1 className="display-type mt-4 text-5xl">Notification settings</h1><p className="mt-5 max-w-3xl text-sm leading-6 text-muted">Email is the required foundation. SMS remains independently switchable; automated WhatsApp sending is intentionally absent.</p>{query.notice ? <p className="mt-5 rounded-xl bg-amber/20 p-4 text-sm font-bold">{query.notice}</p> : null}
    <div className="mt-7 grid gap-4 sm:grid-cols-2"><ProviderHealth channel="Email" configured={health.email} /><ProviderHealth channel="SMS" configured={health.sms} /></div>
    <form action={updateNotificationSettingsAction} className="mt-7 grid gap-4 rounded-2xl border border-ink/10 bg-paper p-6 sm:grid-cols-2"><input name="expectedVersion" type="hidden" value={record?.version ?? 0} /><label><input defaultChecked={settings.email.enabled} name="emailEnabled" type="checkbox" /> <strong>Email enabled</strong></label><label><input defaultChecked={settings.sms.enabled} name="smsEnabled" type="checkbox" /> <strong>SMS enabled</strong></label><Text label="From name" name="fromName" value={settings.email.fromName} /><Text label="From email" name="fromEmail" type="email" value={settings.email.fromEmail} /><Text label="Reply-to email" name="replyToEmail" required={false} type="email" value={settings.email.replyToEmail ?? ''} /><Text label="Email maximum attempts" name="emailMaximumAttempts" type="number" value={String(settings.email.maximumAttempts)} /><Text label="SMS sender ID" name="senderId" value={settings.sms.senderId} /><Text label="SMS maximum attempts" name="smsMaximumAttempts" type="number" value={String(settings.sms.maximumAttempts)} /><fieldset className="sm:col-span-2"><legend className="font-black">SMS statuses</legend><div className="mt-3 flex flex-wrap gap-4 text-sm">{statuses.map((status) => <label key={status}><input defaultChecked={settings.sms.enabledStatuses.includes(status)} name="smsEnabledStatuses" type="checkbox" value={status} /> {status}</label>)}</div></fieldset><button className="w-fit rounded-full bg-ink px-5 py-3 text-xs font-black text-paper sm:col-span-2" type="submit">Save channel settings</button></form>
    <h2 className="display-type mt-12 text-4xl">Templates</h2><div className="mt-6 grid gap-5">{statuses.flatMap((status) => (['email', 'sms'] as const).map((channel) => { const stored = templateMap.get(`${status}:${channel}`); const template = stored ?? getFallbackFulfilmentTemplate(status, channel); return <form action={updateNotificationTemplateAction} className="grid gap-4 rounded-2xl border border-ink/10 bg-paper p-6 sm:grid-cols-2" key={`${status}:${channel}`}><input name="fulfilmentStatus" type="hidden" value={status} /><input name="channel" type="hidden" value={channel} /><input name="expectedVersion" type="hidden" value={stored?.version ?? 0} /><h3 className="text-lg font-black sm:col-span-2">{status} Â· {channel}</h3><label><input defaultChecked={stored?.active ?? true} name="active" type="checkbox" /> Active</label><Text label="Provider template ID (optional)" name="providerTemplateId" required={false} value={stored?.providerTemplateId ?? ''} /><Text label="Subject" name="subjectTemplate" required={channel === 'email'} value={template.subjectTemplate ?? ''} /><label className="grid gap-2 text-sm font-bold sm:col-span-2">Body<textarea className={`${field} min-h-28 py-3`} defaultValue={template.bodyTemplate} name="bodyTemplate" required /></label><p className="text-xs text-muted sm:col-span-2">Allowed variables: {'{{customerName}}'}, {'{{orderReference}}'}, {'{{statusLabel}}'}, {'{{trackingUrl}}'}</p><button className="w-fit rounded-full bg-ink px-5 py-3 text-xs font-black text-paper sm:col-span-2" type="submit">Save template version</button></form>; }))}</div>
  </section>;
}

function ProviderHealth({ channel, configured }: { channel: string; configured: boolean }) { return <article className="rounded-2xl border border-ink/10 bg-paper p-5"><p className="text-xs font-black uppercase tracking-[0.14em] text-muted">{channel} gateway</p><p className="mt-2 font-black">{configured ? 'Credentials configured' : 'Not configured â€” sends stay disabled or fail safely'}</p></article>; }
function Text({ label, name, value, required = true, type = 'text' }: { label: string; name: string; value: string; required?: boolean; type?: string }) { return <label className="grid gap-2 text-sm font-bold">{label}<input className={field} defaultValue={value} name={name} required={required} type={type} /></label>; }

