import {
  type EventMap,
  type ModuleKey,
  type TenantRole,
  TOGGLEABLE_MODULES,
} from '@rede-social/contracts';
import type { Hono } from 'hono';
import type { AppEnv } from '../auth/context';

/** Where a module's navigation entry renders in the shell (D-40): a BottomNav/rail tab or a TopBar/rail slot. */
export type ModuleNavPlacement = 'tab' | 'topbar';

/** Which `bootstrap.counters` key feeds a TopBar/rail slot's count badge (D-40). */
export type ModuleNavBadge = 'unreadNotifications' | 'unreadConversations';

/**
 * Navigation entry the shell renders; `order` drives the bootstrap list's sort (ROLE-06 ordering).
 * Everything here is plain data: the manifest lives on the server and travels through
 * `GET /v1/me/bootstrap`, so `icon` is a NAME (`'bell'`, `'users'`, …) that `@rede-social/core/ui`
 * maps to a lucide component — never a React component.
 */
export interface ModuleNav {
  /** Fallback label; the web catalog's `<key>.nav` entry wins when present (PWA-03). */
  label: string;
  /** Icon name resolved by `iconFor()` in `packages/core/ui/nav.ts`; unknown names get a neutral glyph. */
  icon: string;
  href: string;
  order: number;
  /**
   * `'tab'` (default when absent) renders in the BottomNav / rail nav between the kernel's Início and
   * Perfil; `'topbar'` renders as a TopBar slot (mobile) / rail bottom-group row (desktop) — bell,
   * support chat (D-40). A disabled module's entry never reaches the bootstrap, so it never renders.
   */
  placement?: ModuleNavPlacement;
  /** A `'topbar'` slot's count source: the `bootstrap.counters` key whose value renders as a Badge. */
  badge?: ModuleNavBadge;
  /**
   * UI-D-81: `'media'` asks the shell for the dark media chrome while THIS tab is active — the mobile
   * TopBar hides and the BottomNav floats in dark over the content (Reels). The kernel reads it from
   * the nav entry and never tests a pathname, so a future media tab gets the chrome by declaring it.
   * Absent = the normal chrome.
   */
  chrome?: 'media';
}

/**
 * A home-slot declaration (D-42): the module asks for a widget position on `/inicio` at `order`
 * (ascending, ties by module key). The kernel only carries the declaration; the web composition point
 * (`apps/web/lib/registry.tsx`) supplies the renderer per module key and slot index, so the manifest
 * stays serialisable and the kernel never imports module UI (MOD-02).
 */
export interface ModuleHomeSlot {
  order: number;
}

/** A pg-boss job a module owns; `P` is the payload shape the module's own handler expects. */
export interface JobDefinition<P = unknown> {
  name: string;
  handler: (payload: P) => Promise<void>;
}

/**
 * Payload-erased view used by the manifest's `jobs` list and by the worker. A handler's parameter
 * is contravariant, so a `JobDefinition<ExampleProcessJob>` does not fit a `JobDefinition<unknown>`
 * list; the kernel genuinely does not know (and must not know) any module's payload shape. pg-boss
 * hands back whatever JSON was enqueued, and the module that enqueued it owns the shape.
 */
// biome-ignore lint/suspicious/noExplicitAny: deliberate payload erasure — see the note above
export type AnyJobDefinition = JobDefinition<any>;

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
  /**
   * Home-slot declarations (D-42), emitted on the bootstrap entry when present. Settings rows stay
   * static kernel rows this phase — a `settingsRows` extension is Phase 3/7's call.
   */
  home?: ModuleHomeSlot[];
  routes?: () => Promise<Hono<AppEnv>>;
  jobs?: AnyJobDefinition[];
  events?: EventSubscription[];
  defaultRolePermissions?: Partial<Record<TenantRole, string[]>>;
  /**
   * D-121: module keys this module depends on. A module whose required keys are not ALL enabled for
   * the tenant contributes NOTHING — no bootstrap entry, no permission — even while its own flag is
   * on. Enforced by the app tier's composition (`effectiveKeys` in `apps/api/src/modules/registry.ts`),
   * not by the kernel, which never sees another module's manifest.
   */
  requires?: readonly ModuleKey[];
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
