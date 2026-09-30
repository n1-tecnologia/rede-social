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

/** One kind's renderer: its glyph, its sentence and its target (D-232). */
export interface NotificationRenderer {
  glyph: NotificationGlyph;
  glyphTone?: 'neutral' | 'like';
  sentence: (
    facts: NotificationRow['facts'],
    t: NotificationTranslator,
    actorName: string,
  ) => ReactNode;
  href: (facts: NotificationRow['facts']) => string;
}

export interface NotificationRowView {
  id: string;
  href: string;
  unread: boolean;
  leading: { avatar: { src: string | null; alt: string } } | { glyph: true };
  glyph: NotificationGlyph;
  glyphTone: 'neutral' | 'like';
  sentence: ReactNode;
  time: string;
  preview: { assetId: string; widths: number[] } | null;
}

/**
 * The row's view, or `null` when no renderer knows its kind. 07-01 FILTERS such rows out; 07-04
 * replaces the filter with the generic row once its sketch is approved.
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
): NotificationRowView | null {
  const renderer = renderers[row.kind];
  if (!renderer) return null;

  const actorName =
    row.actor === null
      ? ''
      : row.actor.removed
        ? t('actorRemoved')
        : (row.actor.displayName ?? t('actorRemoved'));

  return {
    id: row.id,
    href: renderer.href(row.facts),
    unread: row.readAt === null,
    leading:
      row.actor === null
        ? { glyph: true }
        : { avatar: { src: avatarUrlFor(row.actor.avatarAssetId), alt: actorName } },
    glyph: renderer.glyph,
    glyphTone: renderer.glyphTone ?? 'neutral',
    sentence: renderer.sentence(row.facts, t, actorName),
    time: relativeFrom(row.createdAt, nowMs),
    preview: row.preview
      ? { assetId: row.preview.assetId, widths: row.preview.variantWidths }
      : null,
  };
}
