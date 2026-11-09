import { cn } from '@rede-social/ui';
import { Play } from 'lucide-react';
import { GLASS_CHIP, GLASS_CHIP_LG } from './recipes';

/**
 * A live's status as an over-media chip (2026-10-22, the courses area redesign on the
 * social-igoralves prototype's `LiveHero` / `LiveSpotlight` / `EventMiniCard` chips), IN WORDS, the
 * host's label:
 *
 *  - `live` → the red chip (`bg-danger`, the prototype's red) led by a white dot that breathes
 *    (`animate-live-dot`, 1.4 s; still under "reduzir movimento");
 *  - `replay` → the glass chip led by a filled `Play` 9;
 *  - none → the plain glass chip ("Agendada", "Cancelada", "Hoje").
 *
 * `size` picks the chip of a card (`sm`, 9px) or of a hero / spotlight (`lg`, 10px). The dot and the
 * glyph are `aria-hidden`; the label is the chip's only text. Props only, no words (PWA-03).
 *
 * 2026-10-26: every chip but the red one carries the member skin's glass (`ms-chip`, inert outside
 * `[data-member-skin]`); the red one keeps its solid ground in the skin too.
 */
export interface LiveStatusChipProps {
  label: string;
  icon?: 'live' | 'replay' | null;
  size?: 'sm' | 'lg';
  testId?: string;
  className?: string;
}

export function LiveStatusChip({
  label,
  icon = null,
  size = 'sm',
  testId = 'live-status-chip',
  className,
}: LiveStatusChipProps) {
  return (
    <span
      data-testid={testId}
      data-icon={icon ?? undefined}
      className={cn(
        size === 'lg' ? GLASS_CHIP_LG : GLASS_CHIP,
        icon === 'live' ? 'bg-danger backdrop-blur-none' : 'ms-chip',
        className,
      )}
    >
      {icon === 'live' ? (
        <span
          aria-hidden
          data-testid="live-status-dot"
          className={cn(
            'shrink-0 animate-live-dot rounded-full bg-white motion-reduce:animate-none',
            size === 'lg' ? 'h-1.5 w-1.5' : 'h-1 w-1',
          )}
        />
      ) : null}
      {icon === 'replay' ? (
        <Play aria-hidden size={size === 'lg' ? 10 : 9} fill="currentColor" className="shrink-0" />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
