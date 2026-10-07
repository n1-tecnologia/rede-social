import { cn } from '@rede-social/ui';

/**
 * The "Exemplo" tag (2026-10-06): the events screens copy the REINE prototype even where the system
 * has no data yet (a ticket code, a payment, an invoice, a programme, a certificate file). Every such
 * value wears this tag, so no member reads it as real. Amber tint, dark ink (legible at 9px bold).
 */
export function ExampleTag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      data-example-tag=""
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border border-warning/50 bg-warning/15 px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-wider text-text',
        className,
      )}
    >
      {label}
    </span>
  );
}
