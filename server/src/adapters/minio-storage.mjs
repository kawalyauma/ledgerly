import { Readable } from "node:stream";

function requireKey(key) {
  if (typeof key !== "string" || key.trim() === "") throw new TypeError("storage key is required");
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Storage key contains an unsafe traversal segment");
  }
  return parts.join("/");
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export class MinioStorage {
  constructor({ client, bucket, publicBaseUrl = null }) {
    if (!client) throw new TypeError("MinioStorage requires a MinIO client");
    if (typeof bucket !== "string" || bucket.trim() === "") throw new TypeError("MinIO bucket is required");
    this.provider = "minio-s3";
    this.client = client;
    this.bucket = bucket.trim();
    this.publicBaseUrl = publicBaseUrl;
  }

  async put(key, bytes, metadata = {}) {
    const objectKey = requireKey(key);
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const headers = {};
    if (metadata.contentType) headers["Content-Type"] = metadata.contentType;
    for (const [name, value] of Object.entries(metadata.custom ?? {})) {
      headers[`X-Amz-Meta-${name}`] = String(value);
    }
    await this.client.putObject(this.bucket, objectKey, body, body.length, headers);
    return { key: objectKey, size: body.length, provider: this.provider };
  }

  async get(key) {
    const stream = await this.client.getObject(this.bucket, requireKey(key));
    return streamToBuffer(stream);
  }

  async head(key) {
    try {
      const stat = await this.client.statObject(this.bucket, requireKey(key));
      return {
        key: requireKey(key),
        size: Number(stat.size ?? 0),
        etag: stat.etag ?? null,
        lastModified: stat.lastModified ?? null,
        metadata: stat.metaData ?? {},
      };
    } catch (error) {
      const code = error?.code ?? error?.name;
      if (["NoSuchKey", "NotFound", "NoSuchObject"].includes(code)) return null;
      throw error;
    }
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
      stream.on("data", (item) => {
        if (item?.name) keys.push(item.name);
      });
      stream.once("error", reject);
      stream.once("end", resolve);
    });
    return keys.sort();
  }

  async createDownloadUrl(key, { expiresSeconds = 900 } = {}) {
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1) {
      throw new TypeError("expiresSeconds must be a positive integer");
    }
    return this.client.presignedGetObject(this.bucket, requireKey(key), expiresSeconds);
  }

  async health() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      return { ok: exists === true, provider: this.provider, bucket: this.bucket };
    } catch (error) {
      return {
        ok: false,
        provider: this.provider,
        bucket: this.bucket,
        error: error instanceof Error ? error.message : String(error),
      };
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
  });
}
