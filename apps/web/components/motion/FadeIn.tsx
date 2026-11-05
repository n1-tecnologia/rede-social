'use client';

import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

type FadeInProps = {
  /** The element: a plain block, a `section` or a list item. */
  as?: 'div' | 'section' | 'li';
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
};

/**
 * 2026-10-22 — the courses area's fade (the social-igoralves prototype's 0.18 s content swap,
 * opacity only) for content that APPEARS on a client already running: a module just created in the
 * curriculum editor, an item a client action inserts.
 *
 * It never plays on the server's first paint: a page must be readable before (and without) its
 * JavaScript, so content rendered on the server, or hydrated from it, starts visible. Content a full
 * page load brings (a filter chip is a link) enters with the CSS `animate-swap-in` instead, which
 * runs at first paint. It never plays when the member asked the OS for less motion. Opacity only, on
 * purpose: a transform would make the wrapper a stacking context and trap the inline sheets and
 * dialogs of its subtree under it.
 */
export function FadeIn({ as = 'div', className, children, ...rest }: FadeInProps) {
  // `false` during the server render and hydration, `true` for anything mounted afterwards.
  const mountedOnClient = useSyncExternalStore(subscribe, onClient, onServer);
  const reduce = useReducedMotion();
  const animate = mountedOnClient && !reduce;
  const Tag = as === 'section' ? motion.section : as === 'li' ? motion.li : motion.div;
  return (
    <Tag
      className={className}
      initial={animate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
