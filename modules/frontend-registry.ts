import type { FrontendGlobalAction, FrontendModuleDefinition, FrontendNavigationGroup, FrontendRoute } from "./frontend-types";

// Vite expands this at build time. Adding modules/<name>/frontend/module.tsx is enough
// for UI routes/navigation/global actions to be discovered without hard-coding modules in App.tsx or AppShell.tsx.
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

export const appGlobalActions: FrontendGlobalAction[] = frontendModules
  .flatMap(module => module.globalActions ?? [])
  .sort((a,b)=>(a.order??100)-(b.order??100)||a.label.localeCompare(b.label));
