import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Card surface (prototype `.card-magazine`): tokenised fill, 12px radius, hairline border in dark. */
export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl bg-card shadow-[0_1px_3px_rgba(22,35,59,.06)] dark:border dark:border-border',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
