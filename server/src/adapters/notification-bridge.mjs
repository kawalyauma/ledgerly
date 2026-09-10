function requireText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required`);
  return value.trim();
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function notificationBody(notification) {
  return requireText(notification?.body ?? notification?.message, "notification body");
}

class EgoSmsProvider {
  constructor({ apiUrl, username, password, senderId, timeoutMs, fetchImpl }) {
    this.provider = "egosms";
    this.apiUrl = apiUrl || "https://www.egosms.co/api/v1/plain/";
    this.username = username;
    this.password = password;
    this.senderId = senderId;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  configured() {
    return Boolean(this.username && this.password && this.senderId);
  }

  async send(notification) {
    if (!this.configured()) throw new Error("EgoSMS is not configured");
    const url = new URL(this.apiUrl);
    url.searchParams.set("username", this.username);
    url.searchParams.set("password", this.password);
    url.searchParams.set("number", requireText(notification.recipient, "recipient").replace(/^\+/, ""));
    url.searchParams.set("message", notificationBody(notification));
    url.searchParams.set("sender", this.senderId);
    const response = await fetchWithTimeout(this.fetchImpl, url, { method: "GET" }, this.timeoutMs);
    const text = await response.text();
    if (!response.ok || /error|failed|invalid/i.test(text)) {
      throw new Error(`EgoSMS failed: ${text.slice(0, 300) || `HTTP ${response.status}`}`);
    }
    return { provider: this.provider, providerMessageId: text.trim() || null };
  }
}

class WhatsAppHubProvider {
  constructor({ hubUrl, appKey, templateName, language, timeoutMs, fetchImpl }) {
    this.provider = "whatsapp-support-hub";
    this.hubUrl = hubUrl?.replace(/\/$/, "");
    this.appKey = appKey;
    this.templateName = templateName || "general_app_update";
    this.language = language || "en_US";
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  configured() {
    return Boolean(this.hubUrl && this.appKey);
  }

  async send(notification) {
    if (!this.configured()) throw new Error("WhatsApp support hub is not configured");
    const body = notificationBody(notification);
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.hubUrl}/v1/integrations/templates/send`,
      {
        method: "POST",
        headers: {
          "X-API-Key": this.appKey,
          "Content-Type": "application/json",
          ...(notification.deliveryId ? { "Idempotency-Key": String(notification.deliveryId) } : {}),
        },
        body: JSON.stringify({
          phoneNumber: requireText(notification.recipient, "recipient"),
          templateName: notification.templateName || this.templateName,
          language: notification.templateLanguage || this.language,
          variables: notification.variables || [
            notification.recipientName || "Recipient",
            notification.senderName || "Ledgerly",
            notification.subject || "Update",
            body,
          ],
        }),
      },
      this.timeoutMs,
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      throw new Error(payload?.error?.message || `WhatsApp Hub failed with HTTP ${response.status}`);
    }
    return {
      provider: this.provider,
      providerMessageId: String(payload?.data?.messageId || payload?.data?.id || "") || null,
    };
  }
}

class ResendProvider {
  constructor({ apiUrl, apiKey, fromEmail, timeoutMs, fetchImpl }) {
    this.provider = "resend";
    this.apiUrl = apiUrl || "https://api.resend.com/emails";
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  configured() {
    return Boolean(this.apiKey && this.fromEmail);
  }

  async send(notification) {
    if (!this.configured()) throw new Error("Resend is not configured");
    const response = await fetchWithTimeout(
      this.fetchImpl,
      this.apiUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(notification.deliveryId ? { "Idempotency-Key": String(notification.deliveryId) } : {}),
        },
        body: JSON.stringify({
          from: notification.from || this.fromEmail,
          to: [requireText(notification.recipient, "recipient")],
          subject: requireText(notification.subject || "Ledgerly notification", "subject"),
          text: notificationBody(notification),
        }),
      },
      this.timeoutMs,
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `Resend failed with HTTP ${response.status}`);
    }
    return { provider: this.provider, providerMessageId: String(payload?.id || "") || null };
  }
}

export class NotificationBridge {
  constructor({ providers, requiredChannels = [] }) {
    this.provider = "provider-bridge";
    this.providers = providers;
    this.requiredChannels = new Set(requiredChannels);
  }

  async send(notification) {
    const channel = requireText(notification?.channel, "notification channel").toLowerCase();
    requireText(notification?.organizationId ?? notification?.organization_id, "organizationId");
    const provider = this.providers[channel];
    if (!provider) throw new Error(`Unsupported notification channel: ${channel}`);
    const result = await provider.send(notification);
    return {
      channel,
      deliveryId: notification.deliveryId ?? null,
      recipient: notification.recipient,
      ...result,
    };
  }

  async health() {
    const channels = Object.fromEntries(
      Object.entries(this.providers).map(([channel, provider]) => [channel, { configured: provider.configured() }]),
    );
    const missingRequired = [...this.requiredChannels].filter((channel) => !this.providers[channel]?.configured());
    return {
      ok: missingRequired.length === 0,
      provider: this.provider,
      channels,
      requiredChannels: [...this.requiredChannels],
      missingRequired,
    };
  }
}

export function createNotificationBridge(config, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Notification bridge requires fetch");
  const timeoutMs = config.timeoutMs;
  return new NotificationBridge({
    requiredChannels: config.requiredChannels,
    providers: {
      sms: new EgoSmsProvider({ ...config.sms, timeoutMs, fetchImpl }),
      whatsapp: new WhatsAppHubProvider({ ...config.whatsapp, timeoutMs, fetchImpl }),
      email: new ResendProvider({ ...config.email, timeoutMs, fetchImpl }),
    },
  });
}
