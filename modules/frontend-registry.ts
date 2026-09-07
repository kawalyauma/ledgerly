import type { FrontendModuleDefinition, FrontendNavigationGroup, FrontendRoute } from "./frontend-types";

// Vite expands this at build time. Adding modules/<name>/frontend/module.tsx is enough
// for the UI routes/navigation to be discovered without touching App.tsx or AppShell.tsx.
const discovered = import.meta.glob<{ default: FrontendModuleDefinition }>("./*/frontend/module.tsx", { eager: true });

export const frontendModules = Object.values(discovered)
  .map(entry => entry.default)
  .filter(Boolean)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));

export const appRoutes: Record<string, FrontendRoute> = {};
for (const module of frontendModules) {
  for (const [path, route] of Object.entries(module.routes)) {
    if (appRoutes[path]) throw new Error(`Duplicate frontend route '${path}' from module '${module.key}'.`);
    appRoutes[path] = route;
  }
}

export const appNavigation: FrontendNavigationGroup[] = frontendModules
  .flatMap(module => module.navigation)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));
