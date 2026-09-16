import type { LucideIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';
import { Card } from './Card';

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Bundled lucide vector — required, the primitive has no async dependency. */
  icon: LucideIcon;
  title: string;
  body?: string;
  /** Optional action slot rendered below the body. */
  action?: ReactNode;
  /** `card` wraps the column in `Card` for in-page empties. */
  variant?: 'plain' | 'card';
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  variant = 'plain',
  className,
  ...props
}: EmptyStateProps) {
  const column = (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-bg-tertiary">
        <Icon aria-hidden size={28} className="text-text-tertiary" />
      </div>
      <h3 className="text-base font-bold leading-tight text-text">{title}</h3>
      {body ? (
        <p className="max-w-[260px] text-sm font-normal leading-relaxed text-text-secondary">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex flex-col items-center">{action}</div> : null}
    </div>
  );

  if (variant === 'card') {
    return (
      <Card className={className} {...props}>
        {column}
      </Card>
    );
  }

  return (
    <div className={cn('flex flex-1 flex-col', className)} {...props}>
      {column}
    </div>
  );
}
