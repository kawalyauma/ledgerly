import { createHash, pbkdf2, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PASSWORD_SCRYPT_N = 16384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_SCRYPT_MAXMEM = 64 * 1024 * 1024;
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function fromHex(value) {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  return Buffer.from(value, "hex");
}

function deriveScrypt(password, salt, n = PASSWORD_SCRYPT_N, r = PASSWORD_SCRYPT_R, p = PASSWORD_SCRYPT_P) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_BYTES, { N: n, r, p, maxmem: PASSWORD_SCRYPT_MAXMEM }, (error, key) => {
      if (error) return reject(error);
      resolve(key);
    });
  });
}

function deriveLegacyPbkdf2(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, PASSWORD_KEY_BYTES, "sha256", (error, key) => {
      if (error) return reject(error);
      resolve(key);
    });
  });
}

export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export async function hashPassword(password) {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const derived = await deriveScrypt(password, salt);
  return `scrypt-v1:${PASSWORD_SCRYPT_N}:${PASSWORD_SCRYPT_R}:${PASSWORD_SCRYPT_P}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function passwordNeedsRehash(encoded) {
  if (!encoded) return true;
  const [algorithm, rawN, rawR, rawP] = encoded.split(":");
  if (algorithm !== "scrypt-v1") return true;
  return Number(rawN) !== PASSWORD_SCRYPT_N || Number(rawR) !== PASSWORD_SCRYPT_R || Number(rawP) !== PASSWORD_SCRYPT_P;
}

export async function verifyPassword(password, encoded) {
  if (!encoded) return false;
  const parts = encoded.split(":");
  const algorithm = parts[0];
  if (algorithm === "scrypt-v1") {
    const [, rawN, rawR, rawP, saltHex, expectedHex] = parts;
    const n = Number(rawN), r = Number(rawR), p = Number(rawP);
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || n < 2 || r < 1 || p < 1) return false;
    if (n > 65536 || r > 32 || p > 16) return false;
    const salt = fromHex(saltHex), expected = fromHex(expectedHex);
    if (!salt || !expected || expected.byteLength !== PASSWORD_KEY_BYTES) return false;
    try {
      const actual = await deriveScrypt(password, salt, n, r, p);
      return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  if (algorithm === "pbkdf2-sha256") {
    const [, rawIterations, saltHex, expectedHex] = parts;
    const iterations = Number(rawIterations);
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2_000_000) return false;
    const salt = fromHex(saltHex), expected = fromHex(expectedHex);
    if (!salt || !expected || expected.byteLength !== PASSWORD_KEY_BYTES) return false;
    try {
      const actual = await deriveLegacyPbkdf2(password, salt, iterations);
      return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  return false;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createId(prefix) {
  if (typeof prefix !== "string" || prefix.trim() === "") throw new TypeError("prefix is required");
  const bytes = randomBytes(16);
  let suffix = "";
  for (const byte of bytes) suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}_${suffix}`;
}
