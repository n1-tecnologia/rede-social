import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface SectionTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** `micro`: 12/700 brand uppercase page micro-header · `group`: 14/700 settings group header. */
  variant?: 'micro' | 'group';
  /** Heading level (default h2). */
  as?: 'h2' | 'h3' | 'h4';
  children: ReactNode;
}

export function SectionTitle({
  variant = 'micro',
  as: Tag = 'h2',
  className,
  children,
  ...props
}: SectionTitleProps) {
  return (
    <Tag
      className={cn(
        variant === 'micro'
          ? 'text-xs font-bold uppercase tracking-wider text-brand'
          : 'text-sm font-bold text-text-secondary',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
