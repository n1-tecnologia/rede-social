import type { ReactNode } from 'react';

/** A home widget registered by a module (D-42): sorted by `order`, then `key`. */
export interface HomeSlot {
  key: string;
  order: number;
  node: ReactNode;
}

export interface HomeSlotsProps {
  slots: ReadonlyArray<HomeSlot>;
  /** Rendered instead of the list when no slot is registered. */
  empty: ReactNode;
}

export function HomeSlots(_props: HomeSlotsProps): ReactNode {
  throw new Error('not implemented');
}
