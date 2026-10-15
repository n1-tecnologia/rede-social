import { cn } from '@rede-social/ui';
import { ChevronLeft } from 'lucide-react';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The level-4 cascade's way back one step: a 44 px tall brand link with a left chevron. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className={cn(
        'inline-flex min-h-11 w-fit items-center gap-1 rounded-md text-sm font-bold text-brand',
        FOCUS_RING,
      )}
    >
      <ChevronLeft aria-hidden size={18} />
      {label}
    </a>
  );
}
