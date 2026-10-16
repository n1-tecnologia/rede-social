import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar } from '@rede-social/module-courses/ui';
import { Card, cn } from '@rede-social/ui';
import { Check, Lock } from 'lucide-react';
import type { TrackDiscKind, TrackStepView } from '@/lib/courses-member-view';
import { CoverGradient } from './HomeShelf';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The 28px disc's ground by state (UI-D-456; the current step's brand ring is accent P-08.6-3). */
const DISC_CLASS: Record<TrackDiscKind, string> = {
  done: 'bg-success text-white',
  current: 'border-2 border-brand bg-bg-secondary text-text',
  next: 'bg-bg-tertiary text-text-tertiary',
  locked: 'bg-bg-tertiary text-text-tertiary',
};

/**
 * "O caminho" (08.6-10, D-439, UI-D-456, A-UI-11, COURSE-35), ported from the prototype's vertical
 * timeline (`app/membros/trilhas/page.tsx` § 3): an `<ol>` named "O caminho: {track}" with one step
 * per published course in path order, each step's state said twice — in words in the eyebrow and
 * by the disc:
 *
 *  - the node column (`w-10`): the 28px disc (`concluida` → the success ground with `Check` 14;
 *    `em_andamento` → the brand ring and the numeral; `a_seguir` → the numeral; `bloqueada` →
 *    `Lock` 12), `aria-hidden` next to the words; under it, unless last, the connector, which takes
 *    the success tint after a completed step and grows with the step;
 *  - the content: "Etapa {nn} · {state}" and a card that is ALWAYS a link to `/cursos/{id}` — a
 *    `bloqueada` step lands on the 08.5 buy path (D-421, D-424): the 56px cover in colour, the title
 *    (`line-clamp-2`) and the meta, or the bar and the "{percent}% · {done} de {total} aulas" line on
 *    the step in progress.
 *
 * No pulsing ring and no mini "Continuar" button (UI-D-463): the card is the link and the hero holds
 * the brand fill. Every word arrives finished from `trackStepView` and renders as React text.
 */
export function TrackTimeline({ ariaLabel, steps }: { ariaLabel: string; steps: TrackStepView[] }) {
  return (
    <ol aria-label={ariaLabel} data-testid="courses-track-path" className="flex flex-col px-4">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            key={step.id}
            aria-label={step.ariaLabel}
            data-testid="courses-track-step"
            data-state={step.state}
            className="flex"
          >
            <span aria-hidden className="flex w-10 shrink-0 flex-col items-center">
              <span
                data-testid="courses-track-step-disc"
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
                  DISC_CLASS[step.disc],
                )}
              >
                {step.disc === 'done' ? <Check size={14} strokeWidth={3} /> : null}
                {step.disc === 'locked' ? <Lock size={12} /> : null}
                {step.disc === 'current' || step.disc === 'next' ? step.numeral : null}
              </span>
              {last ? null : (
                <span
                  data-testid="courses-track-step-connector"
                  className={cn(
                    'my-1 w-px flex-1',
                    step.state === 'concluida' ? 'bg-success/50' : 'bg-divider',
                  )}
                />
              )}
            </span>
            <span className={cn('flex min-w-0 flex-1 flex-col', last ? 'pb-1' : 'pb-6')}>
              <span
                data-testid="courses-track-step-eyebrow"
                className="mt-1 block text-xs font-bold uppercase tracking-wider text-text-tertiary tabular-nums"
              >
                {step.eyebrow}
              </span>
              <Card className="mt-2 p-0">
                <a
                  href={step.href}
                  data-testid="courses-track-step-link"
                  className={`flex gap-3 rounded-[inherit] p-3 transition-opacity active:opacity-80 ${FOCUS}`}
                >
                  <span
                    aria-hidden
                    className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
                  >
                    {step.coverAssetId ? (
                      <MediaImage
                        assetId={step.coverAssetId}
                        widths={PURPOSE_WIDTHS.cover}
                        alt=""
                        sizes="56px"
                        ratio=""
                        className="absolute inset-0 h-full w-full"
                        fallback={<CoverGradient />}
                      />
                    ) : (
                      <CoverGradient />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      data-testid="courses-track-step-title"
                      className="line-clamp-2 break-words text-sm font-bold leading-snug text-text"
                    >
                      {step.title}
                    </span>
                    {step.progress ? (
                      <>
                        <ProgressBar
                          percent={step.progress.percent}
                          label={step.progress.label}
                          size="sm"
                          className="mt-2"
                        />
                        <span className="mt-1 text-xs font-normal text-text-tertiary tabular-nums">
                          {step.progress.line}
                        </span>
                      </>
                    ) : (
                      <span
                        data-testid="courses-track-step-meta"
                        className="mt-1 flex items-center gap-1 text-xs font-normal text-text-tertiary tabular-nums"
                      >
                        {step.locked ? <Lock aria-hidden size={12} className="shrink-0" /> : null}
                        <span className="min-w-0">{step.meta}</span>
                      </span>
                    )}
                  </span>
                </a>
              </Card>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
