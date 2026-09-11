import { webcrypto } from "node:crypto";
import { sha256 } from "./crypto.mjs";
const crypto = webcrypto;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(input) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(input).replace(/=+$/, "")) {
    const idx = alphabet.indexOf(ch.toUpperCase());
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
async function encryptionKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`school-mfa:${secret}`));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}
export async function decryptMfaSecret(appSecret, value) {
  const [a, b] = String(value).split(".");
  if (!a || !b) throw new Error("Invalid encrypted MFA secret");
  const iv = Buffer.from(a, "base64");
  const cipher = Buffer.from(b, "base64");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(appSecret), cipher);
  return new TextDecoder().decode(plain);
}
export async function verifyTotp(secret, code, now = Date.now()) {
  const key = await crypto.subtle.importKey("raw", decodeBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  for (let d = -1; d <= 1; d += 1) {
    const counter = Math.floor(now / 30000) + d;
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setUint32(4, counter, false);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
    const offset = mac[mac.length - 1] & 15;
    const number = ((mac[offset] & 127) << 24) | ((mac[offset + 1] & 255) << 16) | ((mac[offset + 2] & 255) << 8) | (mac[offset + 3] & 255);
    if (String(number % 1_000_000).padStart(6, "0") === String(code).replace(/\s/g, "")) return true;
  }
  return false;
}
export function hashRecoveryCode(code) {
  return sha256(`school-recovery:${String(code).trim().toUpperCase()}`);
}
