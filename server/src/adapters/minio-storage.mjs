import { createHash } from "node:crypto";

function requireKey(key) {
  if (typeof key !== "string" || key.trim() === "") throw new TypeError("storage key is required");
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Storage key contains an unsafe traversal segment");
  }
  return parts.join("/");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function metadataValue(metadata, key) {
  if (!metadata || typeof metadata !== "object") return null;
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(metadata)) {
    const normalized = String(name).toLowerCase();
    if (normalized === wanted || normalized === `x-amz-meta-${wanted}`) return value == null ? null : String(value);
  }
  return null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export class MinioStorage {
  constructor({ client, bucket, publicBaseUrl = null, verifyWrites = true }) {
    if (!client) throw new TypeError("MinioStorage requires a MinIO client");
    if (typeof bucket !== "string" || bucket.trim() === "") throw new TypeError("MinIO bucket is required");
    this.provider = "minio-s3";
    this.client = client;
    this.bucket = bucket.trim();
    this.publicBaseUrl = publicBaseUrl;
    this.verifyWrites = verifyWrites !== false;
  }

  async put(key, bytes, metadata = {}) {
    const objectKey = requireKey(key);
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const digest = sha256(body);
    const requestedDigest = metadataValue(metadata.custom, "sha256");
    if (requestedDigest && requestedDigest !== digest) {
      throw new Error(`Object checksum does not match supplied sha256 metadata for ${objectKey}`);
    }

    const headers = {};
    if (metadata.contentType) headers["Content-Type"] = metadata.contentType;
    for (const [name, value] of Object.entries(metadata.custom ?? {})) {
      if (String(name).toLowerCase() === "sha256") continue;
      headers[`X-Amz-Meta-${name}`] = String(value);
    }
    headers["X-Amz-Meta-sha256"] = digest;
    await this.client.putObject(this.bucket, objectKey, body, body.length, headers);

    if (this.verifyWrites) {
      const stat = await this.client.statObject(this.bucket, objectKey);
      if (Number(stat?.size ?? -1) !== body.length) throw new Error(`Object write size verification failed for ${objectKey}`);
      const storedDigest = metadataValue(stat?.metaData, "sha256");
      if (storedDigest && storedDigest !== digest) throw new Error(`Object write checksum verification failed for ${objectKey}`);
    }
    return { key: objectKey, size: body.length, sha256: digest, verified: this.verifyWrites, provider: this.provider };
  }

  async get(key) {
    const stream = await this.client.getObject(this.bucket, requireKey(key));
    return streamToBuffer(stream);
  }

  async head(key) {
    const objectKey = requireKey(key);
    try {
      const stat = await this.client.statObject(this.bucket, objectKey);
      return {
        key: objectKey,
        size: Number(stat.size ?? 0),
        etag: stat.etag ?? null,
        sha256: metadataValue(stat.metaData, "sha256"),
        lastModified: stat.lastModified ?? null,
        metadata: stat.metaData ?? {},
      };
    } catch (error) {
      const code = error?.code ?? error?.name;
      if (["NoSuchKey", "NotFound", "NoSuchObject"].includes(code)) return null;
      throw error;
    }
  }

  async verify(key, { expectedSize = null, expectedSha256 = null, readBackWhenMetadataMissing = true } = {}) {
    const objectKey = requireKey(key);
    const head = await this.head(objectKey);
    if (!head) return { ok: false, key: objectKey, reason: "missing" };
    if (expectedSize != null && Number(head.size) !== Number(expectedSize)) {
      return { ok: false, key: objectKey, reason: "size_mismatch", actualSize: head.size, expectedSize: Number(expectedSize) };
    }
    if (expectedSha256) {
      let actualSha256 = head.sha256;
      if (!actualSha256 && readBackWhenMetadataMissing) actualSha256 = sha256(await this.get(objectKey));
      if (!actualSha256) return { ok: false, key: objectKey, reason: "checksum_unavailable" };
      if (actualSha256 !== expectedSha256) return { ok: false, key: objectKey, reason: "checksum_mismatch", actualSha256, expectedSha256 };
    }
    return { ok: true, key: objectKey, size: head.size, sha256: head.sha256 ?? expectedSha256 ?? null };
  }

  async delete(key) {
    await this.client.removeObject(this.bucket, requireKey(key));
    return true;
  }

  async list(prefix = "") {
    const normalizedPrefix = prefix ? requireKey(prefix) : "";
    const stream = this.client.listObjectsV2(this.bucket, normalizedPrefix, true);
    const keys = [];
    await new Promise((resolve, reject) => {
      stream.on("data", (item) => { if (item?.name) keys.push(item.name); });
      stream.once("error", reject);
      stream.once("end", resolve);
    });
    return keys.sort();
  }

  async createDownloadUrl(key, { expiresSeconds = 900 } = {}) {
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1) throw new TypeError("expiresSeconds must be a positive integer");
    return this.client.presignedGetObject(this.bucket, requireKey(key), expiresSeconds);
  }

  async health() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      return { ok: exists === true, provider: this.provider, bucket: this.bucket, verifyWrites: this.verifyWrites };
    } catch (error) {
      return { ok: false, provider: this.provider, bucket: this.bucket, verifyWrites: this.verifyWrites, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export async function createMinioStorage(config) {
  const Minio = await import("minio");
  const client = new Minio.Client({
    endPoint: config.host,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
  });

  const exists = await client.bucketExists(config.bucket);
  if (!exists) {
    if (!config.createBucket) throw new Error(`MinIO bucket ${config.bucket} does not exist`);
    await client.makeBucket(config.bucket, config.region);
  }

  return new MinioStorage({
    client,
    bucket: config.bucket,
    publicBaseUrl: config.publicBaseUrl,
    verifyWrites: config.verifyWrites !== false,
  });
}
