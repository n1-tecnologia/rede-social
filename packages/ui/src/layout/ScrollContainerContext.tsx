'use client';

import { createContext, type ReactNode, type RefObject, useContext } from 'react';

/**
 * The app's single scroll root (the shell's `.app-scroll` element). PullToRefresh and any
 * scroll-aware consumer read it from here instead of querying `#app-scroll` by id.
 */
export const ScrollContainerContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function ScrollContainerProvider({
  scrollRef,
  children,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <ScrollContainerContext.Provider value={scrollRef}>{children}</ScrollContainerContext.Provider>
  );
}

/** The scroll root ref, or `null` when rendered outside the shell (the document scrolls). */
export function useScrollContainer(): RefObject<HTMLElement | null> | null {
  return useContext(ScrollContainerContext);
}
