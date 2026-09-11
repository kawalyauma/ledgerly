import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const roots = ["src", "test", "scripts"];

async function collect(directory) {
  const absolute = path.join(ROOT, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(relative));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(relative);
  }
  return files;
}

const files = (await Promise.all(roots.map(collect))).flat().sort();
let failures = 0;
for (const relative of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(ROOT, relative)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    failures += 1;
    process.stderr.write(`\n[syntax] ${relative}\n`);
    process.stderr.write(result.stderr || result.stdout || "Unknown syntax-check failure\n");
  }
}

if (failures > 0) {
  console.error(`Syntax check failed for ${failures} file(s).`);
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} .mjs file(s).`);
}
