'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One 44px-minimum sheet row, shared by the post's menu and the comment's menu (11-20): one geometry,
 * one place. `destructive` tints the label with the danger token, never a hex. The label arrives as a
 * prop (the module ships no language, PWA-03) and is rendered as plain text.
 *
 * `attrs` carries the row's own `data-*` hooks (`data-comment-delete`, ...); it is spread onto the
 * element and never holds a label.
 */
export function MenuRow({
  icon: Icon,
  label,
  destructive,
  onClick,
  href,
  attrs,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onClick?: () => void;
  href?: string;
  attrs?: Record<string, string | undefined>;
}): ReactNode {
  const shape = [
    'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold',
    'transition-colors hover:bg-bg-hover active:bg-bg-tertiary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
    destructive ? 'text-danger' : 'text-text',
  ].join(' ');

  // A plain `<a>` rather than `next/link`: a module package must not depend on the web framework
  // (MOD-02), and the host app is free to intercept the navigation.
  if (href !== undefined) {
    return (
      <a href={href} className={shape} {...attrs}>
        <Icon aria-hidden size={20} className="shrink-0" />
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={shape} {...attrs}>
      <Icon aria-hidden size={20} className="shrink-0" />
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}
