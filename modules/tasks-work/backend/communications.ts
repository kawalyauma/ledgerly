import type { Env } from "../../../src/types";
import { sha256 } from "../../../src/lib/crypto";

async function hubRequest(env: Env, path: string, body: unknown, idempotencyKey?: string) {
  if (!env.WHATSAPP_SUPPORT_APP_KEY || !env.WHATSAPP_SUPPORT_HUB_URL) throw new Error("WhatsApp Hub is not configured");
  const headers: Record<string,string> = { "X-API-Key": env.WHATSAPP_SUPPORT_APP_KEY, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${env.WHATSAPP_SUPPORT_HUB_URL.replace(/\/$/, "")}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const payload = await response.json<{success?:boolean;data?:Record<string,unknown>;error?:{message?:string}}>().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error?.message || `WhatsApp Hub failed with HTTP ${response.status}`);
  return payload.data || {};
}

export async function sendWhatsApp(env: Env, phoneNumber: string, message: string, idempotencyKey: string, template?: {name:string;language?:string;variables?:string[]}) {
  if (template) return hubRequest(env, "/v1/integrations/templates/send", { phoneNumber, templateName: template.name, language: template.language || "en", variables: template.variables || [] }, idempotencyKey);
  return hubRequest(env, "/v1/integrations/messages/send", { phoneNumber, type: "text", message }, idempotencyKey);
}

export async function sendEmail(env: Env, to: string, subject: string, text: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) throw new Error("Resend is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [to], subject, text }),
  });
  const payload = await response.json<Record<string, unknown>>().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.message || `Resend failed with HTTP ${response.status}`));
  return String(payload.id || "");
}

export async function sendSms(env: Env, number: string, message: string) {
  if (!env.EGOSMS_USERNAME || !env.EGOSMS_PASSWORD || !env.EGOSMS_SENDER_ID) throw new Error("EgoSMS is not configured");
  const url = new URL(env.EGOSMS_API_URL || "https://www.egosms.co/api/v1/plain/");
  url.searchParams.set("username", env.EGOSMS_USERNAME);
  url.searchParams.set("password", env.EGOSMS_PASSWORD);
  url.searchParams.set("number", number.replace(/^\+/, ""));
  url.searchParams.set("message", message);
  url.searchParams.set("sender", env.EGOSMS_SENDER_ID);
  const response = await fetch(url, { method: "GET" });
  const result = await response.text();
  if (!response.ok || /error|failed|invalid/i.test(result)) throw new Error(`EgoSMS failed: ${result.slice(0, 300)}`);
  return result.trim();
}

export async function verifyWhatsAppSignature(rawBody: string, header: string | null, secret: string | undefined) {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const received = header.slice(7);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
  if (received.length !== expected.length) return false;
  let mismatch = 0; for (let i=0;i<received.length;i++) mismatch |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

export async function workWebhookReceiptId(request: Request, rawBody: string) {
  return request.headers.get("x-support-delivery-id") || request.headers.get("x-support-idempotency-key") || await sha256(rawBody);
}
