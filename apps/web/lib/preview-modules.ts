import type { NavModule } from '@rede-social/core/ui';

type ManifestNav = NonNullable<NavModule['nav']>;

/** The slice of a module manifest the tenant preview needs: its shell tab, its home slot, its `requires`. */
export type PreviewManifest = {
  nav?: ManifestNav;
  /** `home[0].order` of the manifest: the Início slot position. */
  home?: number;
  requires?: readonly string[];
};

/**
 * Front mirror of the module manifests' SHELL entries, for the platform panel's tenant preview.
 *
 * The manifests (`packages/modules/<key>/module.ts`) import the kernel server and never reach the web
 * bundle, and no platform endpoint returns them, so the preview carries this table. It must stay equal
 * to the manifests it mirrors:
 * - communities: tab `users` `/comunidades`, order 20 (communities/module.ts);
 * - reels: tab `film` `/reels`, order 30, `chrome: 'media'`, `requires: ['feed']` (reels/module.ts);
 * - events: tab `calendar-days` `/eventos`, order 40, home slot 7 (events/module.ts);
 * - stories: home slot 5 (stories/module.ts); feed: home slot 10 (feed/module.ts).
 * `chat` and `notifications` have no manifest yet: enabling them adds nothing to the app, so nothing
 * to the preview either. The fallback labels are the manifests' own; the shell resolves `<key>.nav`
 * from the catalog first, exactly as the app does.
 */
export const PREVIEW_MANIFESTS: Readonly<Record<string, PreviewManifest>> = {
  communities: {
    nav: { placement: 'tab', label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
  },
  reels: {
    nav: {
      placement: 'tab',
      label: 'Reels',
      icon: 'film',
      href: '/reels',
      order: 30,
      chrome: 'media',
    },
    requires: ['feed'],
  },
  events: {
    nav: { placement: 'tab', label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 40 },
    home: 7,
  },
  stories: { home: 5 },
  feed: { home: 10 },
};

/**
 * The API's `effectiveKeys` (apps/api/src/modules/registry.ts) over the mirror: a module whose
 * `requires` is not enabled drops out, repeated to a fixpoint, so Reels without Feed is not in the app.
 */
export function previewEffectiveModules(
  enabled: readonly string[],
  manifests: Readonly<Record<string, PreviewManifest>> = PREVIEW_MANIFESTS,
): string[] {
  const working = new Set(enabled);
  let dropped = true;
  while (dropped) {
    dropped = false;
    for (const key of working) {
      const requires = manifests[key]?.requires ?? [];
      if (requires.some((required) => !working.has(required))) {
        working.delete(key);
        dropped = true;
      }
    }
  }
  return enabled.filter((key) => working.has(key));
}

/** The entries `buildNav` reads (it sorts by `order`, then key, between Início and Perfil). */
export function previewNavModules(
  effective: readonly string[],
  manifests: Readonly<Record<string, PreviewManifest>> = PREVIEW_MANIFESTS,
): NavModule[] {
  return effective.flatMap((key) => {
    const nav = manifests[key]?.nav;
    return nav ? [{ key, nav } as NavModule] : [];
  });
}

/** Início slot keys in render order: `home` order ascending, then key — the `HomeSlots` rule. */
export function previewHomeSlots(
  effective: readonly string[],
  manifests: Readonly<Record<string, PreviewManifest>> = PREVIEW_MANIFESTS,
): string[] {
  return effective
    .flatMap((key) => {
      const order = manifests[key]?.home;
      return order === undefined ? [] : [{ key, order }];
    })
    .sort((a, b) => (a.order === b.order ? a.key.localeCompare(b.key) : a.order - b.order))
    .map((slot) => slot.key);
}
