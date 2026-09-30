import { MediaImage } from '@rede-social/core/ui';
import { Avatar, cn } from '@rede-social/ui';
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Film,
  Heart,
  type LucideIcon,
  MessageCircle,
  MessageCircleReply,
  Newspaper,
  Sparkles,
} from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';

/**
 * The kind glyphs of UI-D-251, by NAME: the web registry picks a name per kind (data, serialisable
 * across the server/client boundary) and this component owns the icon map.
 */
const GLYPHS = {
  Newspaper,
  Film,
  Sparkles,
  CalendarDays,
  CalendarCheck,
  CalendarClock,
  Heart,
  MessageCircleReply,
  MessageCircle,
  Bell,
} as const satisfies Record<string, LucideIcon>;

export type NotificationGlyph = keyof typeof GLYPHS;

export interface NotificationItemProps {
  /** Where a tap lands (D-232). The whole row is ONE `<a>`. */
  href: string;
  /** Fired on activation, before the anchor navigates (07-01 Task 3: the fire-and-forget read). */
  onActivate?: MouseEventHandler<HTMLAnchorElement>;
  /** `read_at` is null: the brand tint plus the `sr-only` unread label (never colour alone). */
  unread: boolean;
  /**
   * With an actor: their avatar plus the kind glyph disc. Without one (reminders, unknown kinds): a
   * 40px disc holding the glyph at 20.
   */
  leading: { avatar: { src: string | null; alt: string } } | { glyph: true };
  glyph: NotificationGlyph;
  /** `like` is the one coloured glyph (UI-D-08); everything else is neutral. */
  glyphTone?: 'neutral' | 'like';
  /** The host-built sentence (the actor in a leading bold span). This component ships no words. */
  sentence: ReactNode;
  /** The server-computed relative time (UI-D-14). */
  time: string;
  /** The 44px trailing thumbnail, only when the facts carry a preview asset. */
  preview?: { assetId: string; widths: readonly number[] } | null;
  /** The catalog's "Não lida." — passed in, because this component ships no words. */
  unreadLabel: string;
  className?: string;
}

/**
 * One notification row [proto], props-only (UI-D-251). The prototype's row, made navigable (D-232):
 * `flex items-start gap-3 px-4 py-3 min-h-16`, tinted `bg-brand/10` while unread, the sentence
 * 14/400 `line-clamp-3` with `[overflow-wrap:anywhere]` so a long unbroken excerpt cannot widen the
 * row, the time 12/400 tertiary, and an optional 44px `MediaImage` preview with no reserved width
 * when absent.
 */
export function NotificationItem({
  href,
  onActivate,
  unread,
  leading,
  glyph,
  glyphTone = 'neutral',
  sentence,
  time,
  preview,
  unreadLabel,
  className,
}: NotificationItemProps) {
  const Glyph = GLYPHS[glyph];
  const toneClass = glyphTone === 'like' ? 'text-like fill-like' : 'text-text-secondary';

  return (
    <a
      href={href}
      onClick={onActivate}
      data-testid="notification-item"
      data-unread={unread ? 'true' : 'false'}
      className={cn(
        'flex min-h-16 items-start gap-3 px-4 py-3 transition-colors hover:bg-bg-hover active:bg-bg-active',
        unread && 'bg-brand/10',
        className,
      )}
    >
      <span className="relative h-10 w-10 shrink-0">
        {'avatar' in leading ? (
          <>
            <Avatar src={leading.avatar.src} alt={leading.avatar.alt} size="md" />
            <span
              aria-hidden
              className="absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full bg-bg-secondary ring-2 ring-bg"
            >
              <Glyph size={12} className={toneClass} />
            </span>
          </>
        ) : (
          <span
            aria-hidden
            className="grid h-10 w-10 place-items-center rounded-full bg-bg-tertiary text-text-secondary"
          >
            <Glyph size={20} className={toneClass} />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="line-clamp-3 text-sm text-text-secondary [overflow-wrap:anywhere]">
          {unread ? <span className="sr-only">{unreadLabel} </span> : null}
          {sentence}
        </span>
        <span className="mt-1 block text-xs text-text-tertiary">{time}</span>
      </span>

      {preview ? (
        <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg">
          <MediaImage
            assetId={preview.assetId}
            widths={preview.widths}
            alt=""
            sizes="44px"
            ratio=""
            className="h-full w-full"
          />
        </span>
      ) : null}
    </a>
  );
}
