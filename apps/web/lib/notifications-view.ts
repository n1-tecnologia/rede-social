import { avatarUrlFor } from '@rede-social/contracts/profiles';
import type { NotificationRow } from '@rede-social/module-notifications/contracts';
import type { NotificationGlyph } from '@rede-social/module-notifications/ui';
import type { ReactNode } from 'react';
import { relativeFrom } from '@/lib/relative-time';

/**
 * Notification row → `NotificationItem` props, built on the SERVER (UI-D-14): the sentence, the href
 * and the relative time are computed here from ONE request instant, so no client render reads a
 * clock or a catalog.
 *
 * The row stores FACTS, never a sentence (CONTEXT). The sentence comes from the web registry's
 * renderer for the row's `kind` (`apps/web/lib/registry.tsx` `notificationRenderers`), which a module
 * contributes per kind. The actor's name is the LIVE one the API read; a departed actor renders the
 * catalog's "Membro removido".
 */

/** The notifications-namespace translator, as the page and the actions hold it. */
export type NotificationTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  rich: (key: string, values: Record<string, unknown>) => ReactNode;
};

/**
 * One kind's renderer: its glyph, its leading form, its sentence and its target (D-232, UI-D-251).
 *
 * `leading: 'glyph'` draws the actor-less 40px disc even when the row names an actor (the generic
 * row); the default `'actor'` draws the actor's avatar with the kind disc, falling back to the glyph
 * disc when the row has no actor at all (reminders). `href` receives the request's ONE instant, so a
 * time-bounded target (an expired story) is decided on the server, never by a client clock.
 */
export interface NotificationRenderer {
  glyph: NotificationGlyph;
  glyphTone?: 'neutral' | 'like';
  leading?: 'actor' | 'glyph';
  sentence: (
    facts: NotificationRow['facts'],
    t: NotificationTranslator,
    actorName: string,
  ) => ReactNode;
  href: (facts: NotificationRow['facts'], nowMs: number) => string;
}

export interface NotificationRowView {
  id: string;
  /** `null` exactly for the removed variant, which is a button with nowhere to go (UI-D-254). */
  href: string | null;
  unread: boolean;
  leading: { avatar: { src: string | null; alt: string } } | { glyph: true };
  glyph: NotificationGlyph;
  glyphTone: 'neutral' | 'like';
  sentence: ReactNode;
  time: string;
  preview: { assetId: string; widths: number[] } | null;
  /** 07-04 keep-and-mark: the target was deleted and the server dropped every fact. */
  removed: boolean;
}

/**
 * UI-D-251's generic row: a kind the web registry does not know yet (a module shipped it before the
 * web did) renders "Você tem uma nova notificação." on the `Bell` disc and opens Início. It never
 * throws and never filters the row out, so a new producer can never break the list.
 */
export const genericNotificationRenderer: NotificationRenderer = {
  glyph: 'Bell',
  leading: 'glyph',
  sentence: (_facts, t) => t('kinds.generic'),
  href: () => '/inicio',
};

/**
 * The row's view. Every row renders: an unmapped kind takes the generic renderer, and a removed row
 * (07-04) keeps its actor and kind glyph but answers the removed sentence, no preview and no href.
 */
export function notificationRowView(
  row: NotificationRow,
  {
    t,
    nowMs,
    renderers,
  }: {
    t: NotificationTranslator;
    nowMs: number;
    renderers: Partial<Record<string, NotificationRenderer>>;
  },
): NotificationRowView {
  const renderer = renderers[row.kind] ?? genericNotificationRenderer;

  const actorName =
    row.actor === null
      ? ''
      : row.actor.removed
        ? t('actorRemoved')
        : (row.actor.displayName ?? t('actorRemoved'));

  const leading: NotificationRowView['leading'] =
    row.actor === null || renderer.leading === 'glyph'
      ? { glyph: true }
      : { avatar: { src: avatarUrlFor(row.actor.avatarAssetId), alt: actorName } };

  const base = {
    id: row.id,
    unread: row.readAt === null,
    leading,
    glyph: renderer.glyph,
    glyphTone: renderer.glyphTone ?? 'neutral',
    time: relativeFrom(row.createdAt, nowMs),
  } as const;

  if (row.removed) {
    return { ...base, href: null, sentence: t('kinds.removed'), preview: null, removed: true };
  }

  return {
    ...base,
    href: renderer.href(row.facts, nowMs),
    sentence: renderer.sentence(row.facts, t, actorName),
    preview: row.preview
      ? { assetId: row.preview.assetId, widths: row.preview.variantWidths }
      : null,
    removed: false,
  };
}
