import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Whether a paid event's confirmations passed its limit (D-751, UI-D-757): strictly above, so a full event
 * (`confirmed === capacity`) and an event with no limit (`capacity === null`) are NOT over. The ONE
 * comparison the Participantes notice and the manage card's pill share; the per-row flag is the SERVER's
 * (`overLimit`, A-UI-13), never recomputed here.
 */
export function isOverLimit(confirmed: number, capacity: number | null): capacity is number {
  return capacity !== null && confirmed > capacity;
}

/**
 * The "Acima do limite" notice above the chips of Participantes (10.1-14, UI-D-757 b): `CircleAlert` and one
 * 12/400 sentence with two ICU plurals. Static text present at load, NOT a live region (nothing announces
 * it; the admin reads it when the screen opens). The sentence says approved payments still confirm after
 * the event fills, which is exactly why the count can pass the limit (D-751). Admin only: the page renders
 * it behind the attendance permission, and a member never receives the numbers.
 */
export function OverLimitNotice({ confirmed, capacity }: { confirmed: number; capacity: number }) {
  const t = useTranslations('events');
  return (
    <div
      data-over-limit-notice
      className="mx-4 mt-4 flex items-start gap-2 rounded-xl bg-warning/10 p-4"
    >
      <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
      <p className="text-xs font-normal text-text">
        {t('participants.overLimitNote', { confirmed, capacity })}
      </p>
    </div>
  );
}
