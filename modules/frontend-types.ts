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

export type FrontendModuleDefinition = {
  key: string;
  name: string;
  version: string;
  order?: number;
  routes: Record<string, FrontendRoute>;
  navigation: FrontendNavigationGroup[];
};
