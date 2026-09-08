import type { ComponentType, ElementType } from "react";

export type FrontendRoute = {
  scope?: string;
  admin?: boolean;
  view: ComponentType;
};

export type FrontendNavigationItem = {
  label: string;
  path: string;
  scope?: string;
  admin?: boolean;
};

export type FrontendNavigationGroup = {
  label: string;
  icon: ElementType;
  order?: number;
  items: FrontendNavigationItem[];
};

export type FrontendGlobalAction = {
  key: string;
  label: string;
  order?: number;
  scope?: string;
  admin?: boolean;
  component: ComponentType<{activePath:string}>;
};

export type FrontendModuleDefinition = {
  key: string;
  name: string;
  version: string;
  order?: number;
  routes: Record<string, FrontendRoute>;
  navigation: FrontendNavigationGroup[];
  /** Optional actions contributed to the global Ledgerly top bar without coupling AppShell to a module. */
  globalActions?: FrontendGlobalAction[];
};
