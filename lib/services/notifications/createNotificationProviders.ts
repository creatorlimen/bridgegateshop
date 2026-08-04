import 'server-only';

import {
  BridgegateNotificationGateway,
  type NotificationProvider,
  UnconfiguredNotificationProvider,
} from '@/lib/services/notifications/NotificationProvider';

function createProvider(
  channel: 'email' | 'sms',
  endpoint: string | undefined,
  token: string | undefined,
): NotificationProvider {
  const normalizedEndpoint = endpoint?.trim();
  const normalizedToken = token?.trim();
  if (!normalizedEndpoint || !normalizedToken) {
    return new UnconfiguredNotificationProvider(channel);
  }
  return new BridgegateNotificationGateway(
    `bridgegate-${channel}-gateway`,
    normalizedEndpoint,
    normalizedToken,
  );
}

export function createNotificationProviders() {
  return {
    email: createProvider(
      'email',
      process.env.NOTIFICATION_EMAIL_GATEWAY_URL,
      process.env.NOTIFICATION_EMAIL_GATEWAY_TOKEN,
    ),
    sms: createProvider(
      'sms',
      process.env.NOTIFICATION_SMS_GATEWAY_URL,
      process.env.NOTIFICATION_SMS_GATEWAY_TOKEN,
    ),
  };
}
