import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One 44px-minimum sheet row: the `PostMenu` shape, which is the product's one menu geometry.
 *
 * It lived inside "Seus stories" (`StoryHistoryList`, UI-D-77) until 2026-10-20, when the story
 * viewer's "Mais opções" sheet (the client's FRONT.pdf: delete a story from the story itself) needed
 * the same row; both menus now draw this one, so the two can never drift apart. A row is an anchor
 * when it navigates (`href`) and a button otherwise; the destructive one is drawn in the danger ink.
 */
export function StoryMenuRow({
  icon: Icon,
  label,
  destructive,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onClick?: () => void;
  href?: string;
}): ReactNode {
  const shape = [
    'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold',
    'transition-colors hover:bg-bg-hover active:bg-bg-tertiary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
    destructive ? 'text-danger' : 'text-text',
  ].join(' ');

  const inner = (
    <>
      <Icon aria-hidden size={20} className={destructive ? undefined : 'text-text-secondary'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={shape}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={shape}>
      {inner}
    </button>
  );
}
