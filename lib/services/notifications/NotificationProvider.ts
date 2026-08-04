import 'server-only';

export type NotificationProviderInput = {
  destination: string;
  subject: string | null;
  body: string;
  idempotencyKey: string;
};

export type NotificationProviderResult = {
  providerMessageId: string;
  safeMessage: string;
};

export interface NotificationProvider {
  readonly name: string;
  send(input: NotificationProviderInput): Promise<NotificationProviderResult>;
}

export class NotificationProviderError extends Error {
  constructor(
    readonly safeCode: 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
    this.name = 'NotificationProviderError';
  }
}

export class UnconfiguredNotificationProvider implements NotificationProvider {
  readonly name = 'unconfigured';

  constructor(private readonly channel: 'email' | 'sms') {}

  async send(): Promise<NotificationProviderResult> {
    throw new NotificationProviderError(
      'NOT_CONFIGURED',
      `${this.channel} delivery is not configured.`,
    );
  }
}

export class BridgegateNotificationGateway implements NotificationProvider {
  constructor(
    readonly name: string,
    private readonly endpoint: string,
    private readonly token: string,
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') {
      throw new NotificationProviderError(
        'NOT_CONFIGURED',
        'Notification gateway must use HTTPS.',
      );
    }
  }

  async send(
    input: NotificationProviderInput,
  ): Promise<NotificationProviderResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        destination: input.destination,
        subject: input.subject,
        body: input.body,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) {
      throw new NotificationProviderError(
        'UNAVAILABLE',
        'Notification gateway is unavailable.',
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      messageId?: unknown;
    } | null;
    if (
      !payload ||
      typeof payload.messageId !== 'string' ||
      !payload.messageId.trim() ||
      payload.messageId.length > 160
    ) {
      throw new NotificationProviderError(
        'INVALID_RESPONSE',
        'Notification gateway returned an invalid response.',
      );
    }
    return {
      providerMessageId: payload.messageId,
      safeMessage: 'Notification accepted by the configured gateway.',
    };
  }
}
