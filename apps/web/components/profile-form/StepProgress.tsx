'use client';

import { cn } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';

/**
 * The head of one step of the member's stepper (12.1-14, D-628; UI-D-653, UI-D-660, UI-D-661).
 *
 * Progress and heading are separate decisions: the eyebrow "Etapa x de y" and the segmented bar show only
 * when the member's path has two or more steps (`showProgress`); the step title `h2` shows whenever the form
 * has step chrome. The bar is decorative (`aria-hidden`): the text carries the meaning, so a pale tenant brand
 * never hides the information. The `h2` takes focus on every step change (`tabIndex={-1}`, `scroll-mt-4`) and
 * is described by the eyebrow. The title is React text, never HTML (T-12.1-12).
 */

export interface StepProgressProps {
  /** The step's title, the section's accessible name. */
  title: string;
  /** The DOM id of the `h2` (the `section` is named by it). */
  headingId: string;
  /** 1-based place of the current step in the member's path. */
  current: number;
  /** How many steps the member's path holds. */
  total: number;
  /** Eyebrow and bar only when the path holds two or more steps. */
  showProgress: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function StepProgress({
  title,
  headingId,
  current,
  total,
  showProgress,
  headingRef,
}: StepProgressProps) {
  const t = useTranslations('profileForm.member.stepper');
  const eyebrowId = `${headingId}-eyebrow`;

  return (
    <div className="flex flex-col gap-2">
      {showProgress ? (
        <>
          <span id={eyebrowId} className="text-xs font-bold text-text-tertiary">
            {t('progress', { current, total })}
          </span>
          <div aria-hidden="true" data-step-bar className="flex gap-1">
            {Array.from({ length: total }, (_, index) => (
              <i
                // The position is the identity of a segment: nothing reorders.
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative segments
                key={index}
                data-segment={index < current ? 'on' : 'off'}
                className={cn(
                  'block h-1 min-w-0 flex-1 rounded-full',
                  index < current ? 'bg-brand' : 'bg-bg-tertiary',
                )}
              />
            ))}
          </div>
        </>
      ) : null}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        aria-describedby={showProgress ? eyebrowId : undefined}
        className="scroll-mt-4 break-words text-base font-bold leading-[1.2] text-text outline-none"
      >
        {title}
      </h2>
    </div>
  );
}
