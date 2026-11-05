import { cn, Skeleton, SkinAmbient } from '@rede-social/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 2026-10-22 — the header of every screen of the courses area, now that each screen is a page of its
 * own reached from the TopBar's area menu (the member's Cursos, Trilhas, Lives and Progresso; the
 * manager's Gerenciar and its lists). It is the social-igoralves prototype's page title: 24px
 * extrabold and tight, in the tenant's title font and colour (`data-brand-title`), a quiet supporting
 * line under it, and, on the admin lists, the "Novo …" action on the right. The member's Início has
 * no such header: its one h1 is the greeting.
 *
 * 2026-10-23: `back` draws a way back in its own row ABOVE the title (the management lists' "‹
 * Gerenciar", as in the reference), and the title row then sits close under it (`pt-1`).
 *
 * The heading block is `min-w-0 flex-1` and breaks words, so a long tenant name wraps the supporting
 * line instead of pushing the action off a 320px screen.
 *
 * 2026-10-26 (the member skin, the academy reference): inside `[data-member-skin]` the heading block
 * is the reference's header surface (`ms-header`: a rounded panel with a floating brand glow, a halo
 * on hover and an edge that fades down), the h1 the page title (`ms-title-page`, large and thin) and
 * the supporting line the lede (`ms-lede`). The hooks are inert on the admin screens, which share
 * this header and keep its look.
 *
 * 2026-10-26 (the reference's "swap completo"): an optional `eyebrow` above the title (a glyph and a
 * small uppercase line, "Sua biblioteca de aprendizado"), and `actionWide` for an action that is a
 * field (the catalogue's search and "Filtros"): it drops under the words on a phone and sits at the
 * right from `md`.
 */
export function ScreenHeader({
  title,
  subtitle,
  titleId,
  action,
  actionWide = false,
  back,
  eyebrow,
  testId,
}: {
  title: string;
  subtitle?: string | null;
  /** A glyph and a small uppercase line above the title. */
  eyebrow?: { icon?: LucideIcon; text: string } | null;
  /** The action is a field (search, filters): under the words on a phone, at the right from `md`. */
  actionWide?: boolean;
  /** The h1's id, for a section that names itself after the screen (`aria-labelledby`). */
  titleId?: string;
  action?: ReactNode;
  back?: ReactNode;
  testId?: string;
}) {
  const heading = (
    <div
      data-testid={testId}
      className={cn(
        'ms-header flex justify-between gap-3 px-4 pb-3',
        actionWide ? 'flex-col md:flex-row md:items-center md:gap-6' : 'items-start',
        back ? 'pt-1' : 'pt-4',
      )}
    >
      <SkinAmbient />
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p
            data-testid={testId ? `${testId}-eyebrow` : undefined}
            className="ms-eyebrow mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary"
          >
            {eyebrow.icon ? (
              <eyebrow.icon aria-hidden size={13} className="shrink-0 text-brand" />
            ) : null}
            <span className="min-w-0 truncate">{eyebrow.text}</span>
          </p>
        ) : null}
        <h1
          id={titleId}
          data-brand-title
          className="ms-title-page break-words text-2xl font-extrabold leading-none tracking-tight text-text"
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="ms-lede mt-1.5 break-words text-xs text-text-tertiary">{subtitle}</p>
        ) : null}
      </div>
      {action ? (
        <div
          className={cn(
            'flex items-center',
            actionWide ? 'w-full gap-2 md:w-auto md:max-w-[440px] md:flex-1' : 'shrink-0',
          )}
        >
          {action}
        </div>
      ) : null}
    </div>
  );
  if (!back) return heading;
  return (
    <>
      <div className="flex px-2 pt-2">{back}</div>
      {heading}
    </>
  );
}

/**
 * The header's placeholder, at its final geometry (a loading screen never shifts when it lands);
 * `withBack` holds the back row's 44px line above it.
 */
export function ScreenHeaderSkeleton({
  withAction = false,
  withBack = false,
}: {
  withAction?: boolean;
  withBack?: boolean;
}) {
  const heading = (
    <div
      aria-hidden
      className={cn(
        'ms-header flex items-start justify-between gap-3 px-4 pb-3',
        withBack ? 'pt-1' : 'pt-4',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton variant="rect" width={140} className="ms-skel-page h-6 rounded-md" />
        <Skeleton variant="rect" width={220} className="ms-skel-lede h-3 rounded-md" />
      </div>
      {withAction ? <Skeleton variant="rect" width={116} className="h-11 rounded-xl" /> : null}
    </div>
  );
  if (!withBack) return heading;
  return (
    <>
      <div aria-hidden className="flex px-2 pt-2">
        <span className="flex min-h-11 items-center pl-1">
          <Skeleton variant="rect" width={88} className="h-3.5 rounded-md" />
        </span>
      </div>
      {heading}
    </>
  );
}
