'use client';

import { cn, ScrollContainerProvider } from '@tria/ui';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';

export interface ScrollRootProps {
  className?: string;
  children: ReactNode;
}

/**
 * The app's single scroll container (UI-SPEC §Shell Contract): `<main class="app-scroll">` scrolls,
 * the document does not. Exposed through `@tria/ui`'s `ScrollContainerContext` so PullToRefresh,
 * sticky sub-headers and the BottomNav's scroll reaction read it instead of querying an id. A route
 * change scrolls it back to the top. No `vh`/`dvh` here or in any page — the height comes from the
 * shell's `--screen-h` contract.
 */
export function ScrollRoot({ className, children }: ScrollRootProps) {
  const ref = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the pathname IS the trigger — a navigation resets the scroll position
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <ScrollContainerProvider scrollRef={ref}>
      <main
        id="app-scroll"
        ref={ref}
        className={cn('app-scroll min-h-0 min-w-0 flex-1', className)}
      >
        {children}
      </main>
    </ScrollContainerProvider>
  );
}
