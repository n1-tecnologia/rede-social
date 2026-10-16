'use client';

import { ProgressBar } from '@rede-social/module-courses/ui';
import {
  LockedSection,
  type ProductChoiceItem,
  ProductChoiceSheet,
} from '@rede-social/module-store/ui';
import { Button, buttonClasses, Card } from '@rede-social/ui';
import { CircleCheck, Play } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { CourseActionView } from '@/lib/courses-member-view';
import type { LockedCourseView } from '@/lib/store-view';

/**
 * The member course page's action zone (08.5-07, UI-D-427, D-430, EP-11, EP-13).
 *
 * **Open course** — the three progress variants, every number the API's:
 *  - `start` (0%) → "{N} aulas · {duration}" 14/400 secondary, then the brand `fullWidth` LINK
 *    "Começar o curso" to `nextLessonId`;
 *  - `continue` (1–99%) → the `h-2` `ProgressBar`, "{percent}% concluído · {done} de {total} aulas
 *    concluídas" 12/400, then "Continuar o curso" — absent when no open lesson is next;
 *  - `done` (100%) → `CircleCheck` + "Curso concluído · {total} de {total} aulas", then the OUTLINE
 *    "Rever o curso" to the first lesson (no brand fill at 100%).
 * A course with no live lesson renders nothing here (`action: null`, EP-13).
 *
 * **Locked course** (UI-D-428, D-424, STORE-23; the courses API answered `locked: true` for a
 * non-staff viewer) — the 08.2 buy section at course scale, composed HERE in the app tier from the
 * store's shipped components (MOD-02: the courses module never imports the store):
 *  - (a) one buyable product → `LockedSection` "Curso exclusivo" + the brand LINK "Comprar para
 *    liberar" to `/loja/{id}?curso={courseId}`;
 *  - (b) several → the same section + a brand BUTTON (`aria-haspopup="dialog"`) opening the shipped
 *    `ProductChoiceSheet` "Opções de acesso", rows to `/loja/{id}?curso={courseId}`;
 *  - (c) none buyable → a `Card` with "Este curso não está à venda no momento.";
 *  - (d) the store read failed → a `Card` with "Não foi possível carregar as opções de compra." and
 *    the outline "Tentar novamente" to the page's own URL.
 * Under any variant, "Assistir à aula aberta" (`ghost sm`, `Play` 16) links the first free lesson
 * when the course has one. No progress bar in a locked zone. A tap never buys: it only navigates to
 * the product page (or opens the picker of products), where the shipped `PurchaseDialog` confirms
 * (UI-D-375, A-UI-2, PR-4). No pressure framing (PR-3): the section informs, the store sells.
 *
 * Links for routes, buttons for in-place actions (UI-D-443). Every string arrives finished from the
 * server (`courseActionView`, `lockedCourseView`). Client only for the sheet's open state.
 */
export interface LockedCourseZone {
  /** Null: the store access read failed → variant (d). */
  view: LockedCourseView | null;
  /** `section: 'many'` only: the sheet rows with the host's thumbs. */
  choices: ProductChoiceItem[];
  /** "Comprar para liberar". */
  buyLabel: string;
  /** "Não foi possível carregar as opções de compra." */
  storeUnavailable: string;
  /** "Tentar novamente". */
  retryLabel: string;
  /** The page's own URL. */
  retryHref: string;
  /** The first free lesson in course order, when the course has one. */
  freeLesson: { href: string; label: string } | null;
}

export interface CourseActionZoneProps {
  /** The open course's progress variant; null renders nothing (EP-13). */
  action: CourseActionView | null;
  /** Present for a locked course: replaces the progress variants (UI-D-428). */
  locked?: LockedCourseZone | null;
}

/**
 * The button look as LINKS (the shipped `Button` is a `<button>`, and a lesson is a route), built by
 * `buttonClasses` so they never drift from it. The two `sm` links carry the 44px hit area
 * (UI-D-443) while keeping their 36px look.
 */
const BRAND_LINK = buttonClasses({ variant: 'brand', size: 'md', fullWidth: true });
const BRAND_LINK_SPACED = buttonClasses({
  variant: 'brand',
  size: 'md',
  fullWidth: true,
  className: 'mt-3',
});
const OUTLINE_LINK = buttonClasses({ variant: 'outline', size: 'md', fullWidth: true });
const OUTLINE_SM_LINK = buttonClasses({
  variant: 'outline',
  size: 'sm',
  hitArea: true,
  className: 'self-start',
});
const GHOST_SM_LINK = buttonClasses({
  variant: 'ghost',
  size: 'sm',
  hitArea: true,
  className: 'mt-2 gap-2 self-center',
});

export function CourseActionZone({ action, locked }: CourseActionZoneProps) {
  if (locked) return <LockedZone zone={locked} />;
  if (!action) return null;
  return (
    <div className="px-4 pt-4">
      <ProgressZone action={action} />
    </div>
  );
}

function LockedZone({ zone }: { zone: LockedCourseZone }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { view } = zone;

  let body: ReactNode;
  if (!view) {
    body = (
      <Card data-testid="course-locked-store-error" className="mx-4 mt-4 flex flex-col gap-3 p-4">
        <p className="text-sm font-normal text-text-secondary">{zone.storeUnavailable}</p>
        <a href={zone.retryHref} data-testid="course-locked-retry" className={OUTLINE_SM_LINK}>
          {zone.retryLabel}
        </a>
      </Card>
    );
  } else if (view.section === 'none') {
    body = (
      <Card data-testid="course-locked-unavailable" className="mx-4 mt-4 p-4">
        <p className="text-sm font-normal text-text-secondary">{view.body}</p>
      </Card>
    );
  } else {
    body = (
      <LockedSection
        title={view.title}
        body={view.body}
        action={
          view.section === 'one' && view.productHref ? (
            <a href={view.productHref} data-testid="course-locked-buy" className={BRAND_LINK}>
              {zone.buyLabel}
            </a>
          ) : (
            <Button
              variant="brand"
              size="md"
              fullWidth
              aria-haspopup="dialog"
              data-testid="course-locked-buy"
              onClick={() => setSheetOpen(true)}
            >
              {zone.buyLabel}
            </Button>
          )
        }
      />
    );
  }

  return (
    <div
      data-testid="course-locked-zone"
      data-section={view ? view.section : 'error'}
      className="flex flex-col"
    >
      {body}
      {zone.freeLesson ? (
        <a href={zone.freeLesson.href} data-testid="course-free-lesson" className={GHOST_SM_LINK}>
          <Play aria-hidden size={16} />
          {zone.freeLesson.label}
        </a>
      ) : null}
      {view?.section === 'many' ? (
        <ProductChoiceSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={view.choiceTitle}
          helper={view.choiceHelper}
          items={zone.choices}
        />
      ) : null}
    </div>
  );
}

function ProgressZone({ action }: { action: CourseActionView }) {
  if (action.variant === 'start') {
    return (
      <div data-testid="course-action" data-variant="start" className="flex flex-col gap-3">
        <p
          data-testid="course-action-line"
          className="text-sm font-normal text-text-secondary tabular-nums"
        >
          {action.line}
        </p>
        {action.href ? (
          <a href={action.href} data-testid="course-action-cta" className={BRAND_LINK}>
            {action.label}
          </a>
        ) : null}
      </div>
    );
  }

  if (action.variant === 'continue') {
    return (
      <div data-testid="course-action" data-variant="continue" className="flex flex-col">
        <ProgressBar percent={action.percent} label={action.progressLabel} size="md" />
        <p
          data-testid="course-action-line"
          className="mt-2 text-xs font-normal text-text-secondary tabular-nums"
        >
          {action.line}
        </p>
        {action.href ? (
          <a href={action.href} data-testid="course-action-cta" className={BRAND_LINK_SPACED}>
            {action.label}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="course-action" data-variant="done" className="flex flex-col gap-3">
      <p
        data-testid="course-action-line"
        className="flex items-center gap-2 text-sm font-normal text-text-secondary tabular-nums"
      >
        <CircleCheck aria-hidden size={16} className="shrink-0 text-success" />
        <span className="min-w-0">{action.line}</span>
      </p>
      {action.href ? (
        <a href={action.href} data-testid="course-action-cta" className={OUTLINE_LINK}>
          {action.label}
        </a>
      ) : null}
    </div>
  );
}
