import 'server-only';

import type { NotificationTemplateDocument } from '@/lib/schemas/notification';

type FulfilmentNotificationStatus =
  | 'preparing'
  | 'readyForPickup'
  | 'dispatched'
  | 'outForDelivery'
  | 'delivered'
  | 'collected';

type TemplateSnapshot = Pick<
  NotificationTemplateDocument,
  | 'templateKey'
  | 'eventType'
  | 'fulfilmentStatus'
  | 'channel'
  | 'locale'
  | 'subjectTemplate'
  | 'bodyTemplate'
  | 'allowedVariables'
  | 'classification'
  | 'templateVersion'
> & { id: string };

const statusCopy: Record<
  FulfilmentNotificationStatus,
  { label: string; message: string }
> = {
  preparing: {
    label: 'Being Prepared',
    message: 'Your order is being prepared for fulfilment.',
  },
  readyForPickup: {
    label: 'Ready for Pickup',
    message: 'Your order is ready for collection during the approved pickup hours.',
  },
  dispatched: {
    label: 'Dispatched',
    message: 'Your order has been dispatched.',
  },
  outForDelivery: {
    label: 'Out for Delivery',
    message: 'Your order is out for delivery.',
  },
  delivered: {
    label: 'Delivered',
    message: 'Your order has been marked as delivered.',
  },
  collected: {
    label: 'Collected',
    message: 'Your pickup order has been marked as collected.',
  },
};

export function getFallbackFulfilmentTemplate(
  status: FulfilmentNotificationStatus,
  channel: 'email' | 'sms',
): TemplateSnapshot {
  const copy = statusCopy[status];
  return {
    id: `fulfilment-${status}-${channel}-placeholder-v1`,
    templateKey: `fulfilment.${status}.${channel}`,
    eventType: 'fulfilment.updated',
    fulfilmentStatus: status,
    channel,
    locale: 'en-NG',
    subjectTemplate:
      channel === 'email'
        ? `Order {{orderReference}}: ${copy.label}`
        : null,
    bodyTemplate:
      channel === 'email'
        ? `Hello {{customerName}},\n\n${copy.message}\n\nTrack the operational status securely: {{trackingUrl}}\n\nReference: {{orderReference}}`
        : `${copy.message} Ref: {{orderReference}}. Track: {{trackingUrl}}`,
    allowedVariables: [
      'customerName',
      'orderReference',
      'statusLabel',
      'trackingUrl',
    ],
    classification: 'transactional',
    templateVersion: 'placeholder-v1',
  };
}

export function renderNotificationTemplate(
  template: TemplateSnapshot,
  variables: Record<
    'customerName' | 'orderReference' | 'statusLabel' | 'trackingUrl',
    string
  >,
) {
  const render = (source: string) =>
    source.replace(
      /{{(customerName|orderReference|statusLabel|trackingUrl)}}/g,
      (_match, variable: keyof typeof variables) => variables[variable],
    );
  return {
    subject: template.subjectTemplate
      ? render(template.subjectTemplate)
      : null,
    body: render(template.bodyTemplate),
  };
}
