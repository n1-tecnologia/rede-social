import type { PhoneLayout } from '@rede-social/core/ui';

/**
 * 2026-11-05 — the phone's menu as the tenant's administrator arranges it in Configurações › Menu
 * do app (the product owner: "personalizar hotbar do usuário selecionando quais itens ele quer que
 * entre ali, a ordem dos itens clicando segurando e arrastando, escolhendo se vai ter algum desses
 * itens no header do app", "somente no mobile"): the bottom bar's items in order, the items moved
 * to the top beside Notificações and the support chat, and the items hidden on the phone.
 *
 * ⚠ Front only until the API keeps it (the tenant has no nav setting): a cookie on THIS device, as
 * the store's setup (`lib/store-setup.ts`). Its value is `b:<keys>|t:<keys>|h:<keys>`, the keys
 * joined by dots, read leniently (a cookie is user input): an unknown or repeated key is dropped and
 * a key keeps its first list. Before it, 2026-10-28's `rede_nav_order` kept the bar's order alone;
 * it is still read as the bar when the layout cookie is absent.
 */

export const PHONE_NAV_LAYOUT_COOKIE = 'rede_nav_layout';
/** 2026-10-28's cookie (Marca's "Menu do celular"): the bar's order only. */
export const LEGACY_NAV_ORDER_COOKIE = 'rede_nav_order';

/** The bar holds two to six items (six fit the 320px phone, `BottomNav`). */
export const PHONE_BAR_MIN = 2;
export const PHONE_BAR_MAX = 6;
/** The administrator's own items at the top, beside the counter slots (four 44px fit at 320px). */
export const PHONE_TOP_MAX = 2;
/** Início always stays in the bar; Perfil never goes to the top (its avatar is already there). */
export const BAR_ONLY = ['home'] as const;
export const NEVER_TOP = ['home', 'profile'] as const;

export type PhonePlacement = 'bar' | 'top' | 'hidden';

const KEY = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_KEYS = 16;

function keysOf(text: string, seen: Set<string>): string[] {
  const keys: string[] = [];
  for (const key of text.split('.')) {
    if (keys.length === MAX_KEYS) break;
    if (KEY.test(key) && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** The cookie's value for a layout. */
export function encodePhoneNavLayout(layout: PhoneLayout): string {
  const part = (keys: readonly string[]) => keys.filter((key) => KEY.test(key)).join('.');
  return `b:${part(layout.bar)}|t:${part(layout.top)}|h:${part(layout.hidden)}`;
}

/** The cookie read back, or `null` when it holds no usable bar (the shell's own menu then). */
export function parsePhoneNavLayout(raw: string | undefined | null): PhoneLayout | null {
  if (!raw) return null;
  const seen = new Set<string>();
  const lists: Record<'b' | 't' | 'h', string[]> = { b: [], t: [], h: [] };
  for (const part of raw.split('|')) {
    const [name, text] = [part.slice(0, 1), part.slice(2)];
    if ((name === 'b' || name === 't' || name === 'h') && part[1] === ':') {
      lists[name] = keysOf(text, seen);
    }
  }
  if (lists.b.length === 0) return null;
  return { bar: lists.b, top: lists.t, hidden: lists.h };
}

/** 2026-10-28's order cookie read as a layout that only orders the bar. */
export function parseLegacyNavOrder(raw: string | undefined | null): PhoneLayout | null {
  if (!raw) return null;
  const bar = keysOf(raw, new Set());
  return bar.length > 0 ? { bar, top: [], hidden: [] } : null;
}

/** Whether an item may take a place: Início only the bar, Perfil never the top. */
export function placementAllowed(key: string, placement: PhonePlacement): boolean {
  if ((BAR_ONLY as readonly string[]).includes(key)) return placement === 'bar';
  if (placement === 'top') return !(NEVER_TOP as readonly string[]).includes(key);
  return true;
}
