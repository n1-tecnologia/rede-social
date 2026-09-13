import {
  type EventMap,
  type ModuleKey,
  type TenantRole,
  TOGGLEABLE_MODULES,
} from '@tria/contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../auth/context';

/** Navigation entry the shell renders; `order` drives the bootstrap list's sort (ROLE-06 ordering). */
export interface ModuleNav {
  label: string;
  icon: string;
  href: string;
  order: number;
}

/** A pg-boss job a module owns (registered by the worker in a later phase). */
export interface JobDefinition<P = unknown> {
  name: string;
  handler: (payload: P) => Promise<void>;
}

/** A domain-event subscription; `EventMap` is declaration-merged by the modules (01-07). */
export interface EventSubscription<K extends keyof EventMap = keyof EventMap> {
  event: K;
  handler: (payload: EventMap[K]) => Promise<void>;
}

/**
 * MOD-02: the contract between the kernel and a feature module. The kernel declares the SHAPE and
 * never imports a module — the registry that holds the instances is composed in `apps/api`
 * (`src/modules/registry.ts`), which is the only tier allowed to depend on both.
 */
export interface ModuleManifest {
  key: ModuleKey;
  nav?: ModuleNav;
  routes?: () => Promise<Hono<AppEnv>>;
  jobs?: JobDefinition[];
  events?: EventSubscription[];
  defaultRolePermissions?: Partial<Record<TenantRole, string[]>>;
}

/**
 * Identity function that pins the manifest's type at the definition site and fails loudly when a
 * module invents a key that is not in `TOGGLEABLE_MODULES` (the same list the `tenant_modules`
 * CHECK is built from, so an unknown key could never be enabled anyway).
 */
export const defineModule = (manifest: ModuleManifest): ModuleManifest => {
  if (!(TOGGLEABLE_MODULES as readonly string[]).includes(manifest.key)) {
    throw new Error(`unknown module key: ${manifest.key}`);
  }
  return manifest;
};
