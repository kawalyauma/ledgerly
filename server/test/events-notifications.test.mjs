import test from "node:test";
import assert from "node:assert/strict";
import { RedisEventBus } from "../src/adapters/redis-events.mjs";
import { createNotificationBridge } from "../src/adapters/notification-bridge.mjs";

class FakePubSubBroker {
  constructor() {
    this.listeners = new Map();
  }
  subscribe(channel, listener) {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }
  unsubscribe(channel) {
    if (Array.isArray(channel)) {
      for (const item of channel) this.listeners.delete(item);
    } else {
      this.listeners.delete(channel);
    }
  }
  publish(channel, raw) {
    const listeners = [...(this.listeners.get(channel) ?? [])];
    for (const listener of listeners) listener(raw, channel);
    return listeners.length;
  }
}

function createFakeRedisPair() {
  const broker = new FakePubSubBroker();
  const publisher = {
    async publish(channel, raw) { return broker.publish(channel, raw); },
    async ping() { return "PONG"; },
  };
  const subscriber = {
    isOpen: true,
    async subscribe(channel, listener) { broker.subscribe(channel, listener); },
    async unsubscribe(channel) { broker.unsubscribe(channel); },
    async quit() { this.isOpen = false; },
  };
  return { publisher, subscriber };
}

test("RedisEventBus distributes events and unsubscribes cleanly", async () => {
  const { publisher, subscriber } = createFakeRedisPair();
  const bus = new RedisEventBus({ publisher, subscriber, namespace: "test" });
  const received = [];
  const unsubscribe = await bus.subscribe("academics.changed", (event, envelope) => {
    received.push({ event, envelope });
  });

  const published = await bus.publish("academics.changed", { organizationId: "org-1", classId: "p5" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(published.published, true);
  assert.equal(published.subscribers, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].event.organizationId, "org-1");
  assert.equal(received[0].envelope.topic, "academics.changed");
  assert.match(received[0].envelope.id, /^[0-9a-f-]{36}$/i);
  assert.equal((await bus.health()).distributed, true);

  await unsubscribe();
  await bus.publish("academics.changed", { organizationId: "org-1", classId: "p6" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(received.length, 1);
  await bus.close();
  assert.equal(subscriber.isOpen, false);
});

function response({ ok = true, status = 200, text = "", json = {} } = {}) {
  return {
    ok,
    status,
    async text() { return text; },
    async json() { return json; },
  };
}

test("NotificationBridge preserves EgoSMS request shape", async () => {
  const calls = [];
  const bridge = createNotificationBridge({
    timeoutMs: 1000,
    requiredChannels: ["sms"],
    sms: { apiUrl: "https://sms.example.test/send", username: "user", password: "secret", senderId: "SCHOOL" },
    whatsapp: {},
    email: {},
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ text: "sms-provider-id" });
    },
  });

  const result = await bridge.send({
    channel: "sms",
    organizationId: "org-1",
    deliveryId: "del-1",
    recipient: "+256700000001",
    body: "School update",
  });
  assert.equal(result.provider, "egosms");
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("username"), "user");
  assert.equal(url.searchParams.get("password"), "secret");
  assert.equal(url.searchParams.get("number"), "256700000001");
  assert.equal(url.searchParams.get("message"), "School update");
  assert.equal(url.searchParams.get("sender"), "SCHOOL");
  assert.equal((await bridge.health()).ok, true);
});

test("NotificationBridge preserves WhatsApp Hub idempotency and template payload", async () => {
  const calls = [];
  const bridge = createNotificationBridge({
    timeoutMs: 1000,
    requiredChannels: ["whatsapp"],
    sms: {},
    whatsapp: { hubUrl: "https://hub.example.test/", appKey: "app-key", templateName: "general_app_update", language: "en_US" },
    email: {},
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ json: { success: true, data: { messageId: "wamid-1" } } });
    },
  });

  const result = await bridge.send({
    channel: "whatsapp",
    organizationId: "org-1",
    deliveryId: "delivery-123",
    recipient: "+256700000002",
    recipientName: "Parent",
    senderName: "Lubowa Memorial Junior School",
    subject: "Fees reminder",
    body: "UGX 100,000 remains outstanding",
  });
  assert.equal(result.providerMessageId, "wamid-1");
  assert.equal(calls[0].url, "https://hub.example.test/v1/integrations/templates/send");
  assert.equal(calls[0].options.headers["X-API-Key"], "app-key");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "delivery-123");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.templateName, "general_app_update");
  assert.deepEqual(payload.variables, ["Parent", "Lubowa Memorial Junior School", "Fees reminder", "UGX 100,000 remains outstanding"]);
});

test("NotificationBridge sends Resend email and reports missing required channels", async () => {
  const calls = [];
  const bridge = createNotificationBridge({
    timeoutMs: 1000,
    requiredChannels: ["email", "sms"],
    sms: {},
    whatsapp: {},
    email: { apiUrl: "https://email.example.test/emails", apiKey: "resend-key", fromEmail: "school@example.test" },
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ json: { id: "email-1" } });
    },
  });

  const health = await bridge.health();
  assert.equal(health.ok, false);
  assert.deepEqual(health.missingRequired, ["sms"]);

  const result = await bridge.send({
    channel: "email",
    organizationId: "org-1",
    deliveryId: "delivery-email-1",
    recipient: "parent@example.test",
    subject: "School notice",
    body: "Tomorrow is visitation day.",
  });
  assert.equal(result.provider, "resend");
  assert.equal(calls[0].options.headers.Authorization, "Bearer resend-key");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "delivery-email-1");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    from: "school@example.test",
    to: ["parent@example.test"],
    subject: "School notice",
    text: "Tomorrow is visitation day.",
  });
});
