#!/usr/bin/env node
import { performance } from "node:perf_hooks";

function int(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function number(name, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function requestOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": "ledgerly-readiness-load-smoke/1" },
      signal: controller.signal,
    });
    await response.arrayBuffer();
    return { ok: response.ok, status: response.status, durationMs: performance.now() - start };
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const baseUrl = process.env.LEDGERLY_SELFHOST_BASE_URL;
  if (!baseUrl) throw new Error("LEDGERLY_SELFHOST_BASE_URL is required");
  const path = process.env.LEDGERLY_LOAD_PATH ?? "/selfhost/ready";
  if (!path.startsWith("/")) throw new Error("LEDGERLY_LOAD_PATH must start with /");
  const url = new URL(path, baseUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("load target must use http or https");

  const requests = int("LEDGERLY_LOAD_REQUESTS", 200, { max: 10000 });
  const concurrency = int("LEDGERLY_LOAD_CONCURRENCY", 10, { max: 200 });
  const timeoutMs = int("LEDGERLY_LOAD_TIMEOUT_MS", 5000, { max: 60000 });
  const maxErrorRate = number("LEDGERLY_LOAD_MAX_ERROR_RATE", 0.01, { max: 1 });
  const maxP95Ms = number("LEDGERLY_LOAD_MAX_P95_MS", 1000, { min: 1, max: 60000 });

  let next = 0;
  const results = new Array(requests);
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= requests) return;
      results[index] = await requestOnce(url, timeoutMs);
    }
  }

  const startedAt = new Date().toISOString();
  const start = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  const elapsedMs = performance.now() - start;

  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
  const failures = results.filter((result) => !result.ok);
  const statusCounts = {};
  for (const result of results) {
    const key = result.status == null ? "network-error" : String(result.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }
  const errorRate = failures.length / requests;
  const p95Ms = percentile(durations, 95);
  const report = {
    ok: errorRate <= maxErrorRate && p95Ms <= maxP95Ms,
    startedAt,
    completedAt: new Date().toISOString(),
    target: url.toString(),
    requests,
    concurrency,
    elapsedMs,
    requestsPerSecond: elapsedMs > 0 ? requests / (elapsedMs / 1000) : null,
    errorRate,
    thresholds: { maxErrorRate, maxP95Ms },
    latencyMs: {
      min: durations[0] ?? 0,
      p50: percentile(durations, 50),
      p95: p95Ms,
      p99: percentile(durations, 99),
      max: durations.at(-1) ?? 0,
    },
    statusCounts,
    sampleErrors: failures.slice(0, 10).map(({ status, error, durationMs }) => ({ status, error, durationMs })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    component: "load-smoke",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
