import { MEMBER_CARD } from '@rede-social/module-courses/ui';
import { Card, cn } from '@rede-social/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 2026-10-23 — for a host on a WIDE screen (the member screens lifted to 1280px): from `md` the card
 * keeps a readable 560px, centred, instead of stretching across the whole row, and never less than
 * the 16px gutter on each side. Opt-in through `className`, so the hosts in the 680px column keep
 * their full-width card.
 */
export const MEMBER_EMPTY_WIDE = 'md:mx-auto md:w-[calc(100%-2rem)] md:max-w-[560px]';

/**
 * 2026-10-22 — the member area's empty and error card (the social-igoralves prototype's catalogue
 * empty card), in place of the shipped `EmptyState` on the member screens: the outlined card
 * (`MEMBER_CARD`), a 48px disc on the input ground with the glyph in the brand ink (an empty list)
 * or the danger ink (`tone="error"`, a failed read), the title 14/700 as a heading, the body 12px
 * and the host's action (a retry link, "Ver todos os cursos", "Começar agora") centred under it.
 *
 * The same contract as `EmptyState`'s card: `data-testid` on the card, the title a heading, the
 * action a slot, so the screens and their tests keep their hooks. Words arrive from the host.
 *
 * 2026-10-26 (the member skin): a glass panel (`ms-panel`) with the larger radius, the disc a quiet
 * glass chip and the title 15/600.
 */
export function MemberEmptyCard({
  icon: Icon,
  title,
  body,
  action,
  tone = 'brand',
  as: Heading = 'h2',
  className,
  'data-testid': testId,
}: {
  icon: LucideIcon;
  title: string;
  body?: string | null;
  action?: ReactNode;
  tone?: 'brand' | 'error';
  as?: 'h2' | 'h3';
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <Card
      data-testid={testId}
      className={cn(
        MEMBER_CARD,
        'ms-panel flex flex-col items-center rounded-3xl px-6 py-8 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'ms-chip-surface mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-input',
          tone === 'error' ? 'text-danger' : 'text-brand',
        )}
      >
        <Icon size={22} />
      </span>
      <Heading className="text-[15px] font-semibold text-text [overflow-wrap:anywhere]">
        {title}
      </Heading>
      {body ? (
        <p className="mt-1 max-w-[30ch] text-xs font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex flex-col items-center">{action}</div> : null}
    </Card>
  );
}
