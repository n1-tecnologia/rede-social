import { cn } from '@rede-social/ui';
import type { ReactNode } from 'react';

/**
 * A card that opens what is behind it (a list, a detail), as on the member report: the whole card is
 * a plain link (a server navigation, no client JS). `group/link` drives the card's hover: a
 * `KpiCard` with `linked` lifts and turns its arrow, a host's own card takes `LIFT`. `id` is the
 * anchor a "Voltar" returns to.
 */
export function CardLink({
  href,
  id,
  className,
  children,
}: {
  href: string;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      id={id}
      className={cn(
        'group/link grid scroll-mt-20 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        className,
      )}
    >
      {children}
    </a>
  );
}
