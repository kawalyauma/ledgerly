import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = process.argv[2];
if (!raw) {
  console.error('Usage: npm run module:new -- library "Library Management"');
  process.exit(1);
}
const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
const displayName = process.argv[3] || slug.split("-").map(x => x[0]?.toUpperCase() + x.slice(1)).join(" ");
const dir = path.join(root, "modules", slug);
try { await access(dir); throw new Error(`Module folder already exists: modules/${slug}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(path.join(dir, "backend"), { recursive: true });
await mkdir(path.join(dir, "frontend"), { recursive: true });

await writeFile(path.join(dir, "module.json"), JSON.stringify({
  key: slug,
  name: displayName,
  version: "1.0.0",
  description: `${displayName} module.`,
  category: "business",
  core: false,
  active: true,
  manifest: {},
}, null, 2) + "\n");

await writeFile(path.join(dir, "backend", "index.ts"), `import { Hono } from "hono";\nimport type { AppVariables, Env } from "../../../src/types";\nimport { requireModuleEnabled } from "../../../src/lib/modules";\n\nexport const routes = new Hono<{Bindings:Env;Variables:AppVariables}>();\nroutes.use("*", requireModuleEnabled("${slug}"));\nroutes.get("/", c => c.json({ data: { module: "${slug}", ready: true } }));\n`);

await writeFile(path.join(dir, "backend", "module.ts"), `import type { BackendModuleDefinition } from "../../backend-types";\nimport { routes } from "./index";\n\nexport const moduleDefinition: BackendModuleDefinition = {\n  key: "${slug}",\n  name: ${JSON.stringify(displayName)},\n  version: "1.0.0",\n  order: 200,\n  routes: [{ basePath: "/api/v1/${slug}", router: routes }],\n};\n`);

await writeFile(path.join(dir, "frontend", "ModulePage.tsx"), `import { Card } from "../../../web/components/ui";\n\nexport function ModulePage(){return <div className="page"><div className="page-heading"><div><span className="eyebrow">Module</span><h1>${displayName}</h1><p>This module is ready for implementation.</p></div></div><Card><p>Build ${displayName} here.</p></Card></div>}\n`);

await writeFile(path.join(dir, "frontend", "module.tsx"), `import { AppWindow } from "lucide-react";\nimport type { FrontendModuleDefinition } from "../../frontend-types";\nimport { ModulePage } from "./ModulePage";\n\nconst moduleDefinition:FrontendModuleDefinition={\n  key:"${slug}",name:${JSON.stringify(displayName)},version:"1.0.0",order:200,\n  routes:{"${slug}":{view:ModulePage}},\n  navigation:[{label:${JSON.stringify(displayName)},icon:AppWindow,order:200,items:[{label:${JSON.stringify(displayName)},path:"${slug}"}]}],\n};\nexport default moduleDefinition;\n`);

await import("./sync-modules.mjs");
console.log(`Created and registered modules/${slug}.`);
