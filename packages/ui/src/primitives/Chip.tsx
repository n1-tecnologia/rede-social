'use client';

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from 'react';
import { cn } from '../cn';
import { chipBase } from './chipBase';

type ChipBaseProps = {
  active?: boolean;
  children: ReactNode;
  className?: string;
};

type ChipLinkProps = ChipBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'onClick'> & {
    href: string;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  };

type ChipButtonProps = ChipBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'onClick'> & {
    href?: undefined;
    onClick: MouseEventHandler<HTMLButtonElement>;
  };

type ChipStaticProps = ChipBaseProps & { href?: undefined; onClick?: undefined };

export type ChipProps = ChipLinkProps | ChipButtonProps | ChipStaticProps;

/**
 * Filter / segmented-choice chip. Renders `<a>` with `href`, `<button aria-pressed>` with `onClick`,
 * otherwise a plain `<span>`. Active = brand fill, idle = input surface.
 *
 * The geometry comes from `chipBase.ts`, shared with StatusPill. It is not declared (nor
 * re-exported) here: this is a 'use client' module, and a value exported from it reaches a Server
 * Component as a client-reference function that `cn()` drops (PDF item #9, see chipBase.ts).
 */
export function Chip(props: ChipProps) {
  const { active = false, children, className } = props;
  const classes = cn(
    chipBase,
    active ? 'bg-brand text-on-brand' : 'bg-bg-input text-text-secondary hover:bg-bg-active',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    className,
  );

  if (props.href !== undefined) {
    const { active: _a, children: _c, className: _cn, ...anchor } = props;
    return (
      <a aria-current={active ? 'page' : undefined} className={classes} {...anchor}>
        {children}
      </a>
    );
  }

  if (props.onClick !== undefined) {
    const {
      active: _a,
      children: _c,
      className: _cn,
      href: _h,
      type = 'button',
      ...button
    } = props;
    return (
      <button type={type} aria-pressed={active} className={classes} {...button}>
        {children}
      </button>
    );
  }

  return <span className={classes}>{children}</span>;
}
