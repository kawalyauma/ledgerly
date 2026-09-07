import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const configPath = path.join(projectRoot, "wrangler.jsonc");

if (!fs.existsSync(configPath)) {
  console.error("wrangler.jsonc was not found in the project root.");
  process.exit(1);
}

const original = fs.readFileSync(configPath, "utf8");
let config;
try {
  config = JSON.parse(original);
} catch (error) {
  console.error("Could not safely update wrangler.jsonc because it is not strict JSON.");
  console.error("Keep your existing bindings and add the assets block documented by this patch manually.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const d1 = Array.isArray(config.d1_databases)
  ? config.d1_databases.find((item) => item?.binding === "FINANCE_DB")
  : undefined;

if (!d1?.database_id || d1.database_id === "REPLACE_WITH_D1_DATABASE_ID") {
  console.warn("WARNING: FINANCE_DB does not currently contain a real Cloudflare D1 database_id.");
  console.warn("Single-origin configuration will still be written, but production deploy will fail until that ID is restored.");
}

config.assets = {
  directory: "./dist",
  not_found_handling: "single-page-application",
  run_worker_first: [
    "/api/*",
    "/auth/*",
    "/system/*",
    "/docs",
    "/openapi.json"
  ]
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

const packagePath = path.join(projectRoot, "package.json");
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  pkg.scripts ||= {};
  pkg.scripts["single-origin:ensure"] = "node scripts/ensure-single-origin.mjs";
  pkg.scripts.predev = "npm run build:web && node scripts/ensure-single-origin.mjs";
  pkg.scripts.predeploy = "npm run build:web && node scripts/ensure-single-origin.mjs";
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log("Single-origin Worker assets are configured.");
console.log("Frontend: / and SPA routes -> ./dist");
console.log("API: /api/*, /auth/*, /system/*, /docs, /openapi.json -> Worker");
console.log("Existing D1/R2/Queue IDs and bindings were preserved.");
console.log("npm run dev and npm run deploy will build the frontend before Wrangler starts.");
