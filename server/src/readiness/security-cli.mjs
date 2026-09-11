#!/usr/bin/env node
import { resolve } from "node:path";
import { assessRepositoryExposure } from "./security-exposure.mjs";

async function main() {
  const root = process.env.LEDGERLY_REPOSITORY_ROOT
    ? resolve(process.env.LEDGERLY_REPOSITORY_ROOT)
    : resolve(process.cwd(), "..");
  const result = await assessRepositoryExposure({ root });
  console.log(JSON.stringify({
    ok: result.ok,
    checkedAt: new Date().toISOString(),
    repositoryRoot: root,
    ...result,
  }, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    component: "security-exposure",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
