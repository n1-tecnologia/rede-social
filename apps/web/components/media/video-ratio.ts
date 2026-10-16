import { useSyncExternalStore } from 'react';

/**
 * The real proportion of every video the tab has seen (2026-10-09), shared by the feed's
 * `FeedVideo` and the Reels `ReelVideo`.
 *
 * **Why the browser learns it.** A video asset never carries a stored size: only images are probed
 * on upload, and the provider's `ready` job keeps an aspect ratio the feed payload does not expose.
 * So each surface learns it from what the player already loads: the provider's poster, a still of
 * the video at the video's own proportion (`probePosterRatio`, early), and the element's
 * `loadedmetadata` (later, on iPhone sometimes only after play). What one surface learns the other
 * reuses, and a video that comes back (a remount, the feed after a post, a reload) opens at its own
 * shape instead of jumping.
 *
 * **Persisted per tab.** The map lives in `sessionStorage` under one key, at most `MAX_RATIOS`
 * assets, the oldest dropped first. Where storage throws (a private window, blocked site data) it
 * lives in memory for the document, which still covers every soft navigation.
 *
 * **The RAW `width / height` is kept.** Each surface applies its own rule to it: the feed clamps it
 * (`feedVideoRatio`), Reels picks a fit (`reelFit`).
 *
 * **Server render.** Nothing is known on the server: `useKnownVideoRatio` reads `null` there and
 * while hydrating, then the remembered value, so the server HTML and the first client render agree.
 */

const STORAGE_KEY = 'rede-social:video-ratios';
/** Far more videos than one visit scrolls past; the oldest fall off. */
export const MAX_RATIOS = 200;

type Listener = () => void;

/** Asset id → `width / height`, oldest first. `null` until this document first reads it. */
let ratios: Map<string, number> | null = null;
let storageBroken = false;
const listeners = new Set<Listener>();

function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sessionStore(): Storage | null {
  if (storageBroken || typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    storageBroken = true;
    return null;
  }
}

/** The map, read from storage once per document. An entry this module did not write is dropped. */
function load(): Map<string, number> {
  if (ratios) return ratios;
  const loaded = new Map<string, number>();
  const store = sessionStore();
  if (store) {
    try {
      const value: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? 'null');
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [assetId, ratio] of Object.entries(value)) {
          if (isRatio(ratio)) loaded.set(assetId, ratio);
        }
      }
    } catch {
      // Not a value this module wrote, or a storage that throws: start empty.
    }
  }
  ratios = loaded;
  return loaded;
}

function save(map: Map<string, number>): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    storageBroken = true;
  }
}

/** The remembered `width / height` of `assetId`, or `null` when no surface has learned it yet. */
export function knownVideoRatio(assetId: string): number | null {
  if (typeof window === 'undefined') return null;
  return load().get(assetId) ?? null;
}

/**
 * Remembers what a surface measured for `assetId` (a non-positive or non-finite value is ignored)
 * and tells every mounted video, so a card and a Reel of the same asset take it at once.
 */
export function rememberVideoRatio(assetId: string, ratio: number): void {
  if (typeof window === 'undefined' || !isRatio(ratio)) return;
  const map = load();
  if (map.get(assetId) === ratio) return;
  // Re-inserted last, so the asset counts as the newest.
  map.delete(assetId);
  map.set(assetId, ratio);
  for (const oldest of map.keys()) {
    if (map.size <= MAX_RATIOS) break;
    map.delete(oldest);
  }
  save(map);
  for (const listener of listeners) listener();
}

export function subscribeVideoRatios(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const knownOnServer = () => null;

/** `knownVideoRatio` as React state: `null` on the server and while hydrating, then live. */
export function useKnownVideoRatio(assetId: string): number | null {
  return useSyncExternalStore(subscribeVideoRatios, () => knownVideoRatio(assetId), knownOnServer);
}

/**
 * Loads `url` in an off-DOM image (the browser's cache serves it to the player's own poster too)
 * and resolves the decoded image, or `null` when it fails or has no size. The URL carries the
 * thumbnail token, so it is only ever set on this detached image, never on an element of the page.
 */
export function loadPoster(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const image = new Image();
    const settle = (loaded: boolean) => {
      image.onload = null;
      image.onerror = null;
      resolve(loaded && image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    };
    image.onload = () => settle(true);
    image.onerror = () => settle(false);
    image.src = url;
  });
}

/** The poster's `width / height` (`loadPoster`), or `null` when it does not load. */
export async function probePosterRatio(url: string): Promise<number | null> {
  const image = await loadPoster(url);
  return image ? image.naturalWidth / image.naturalHeight : null;
}

/** A fresh document: nothing remembered, storage emptied (tests). Subscribers stay subscribed. */
export function resetVideoRatios(): void {
  ratios = null;
  storageBroken = false;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was persisted where storage throws (or there is no window).
  }
}
