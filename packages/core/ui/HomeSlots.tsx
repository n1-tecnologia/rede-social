import type { ReactNode } from 'react';

/** A home widget registered by a module (D-42): sorted by `order`, then `key`. */
export interface HomeSlot {
  key: string;
  order: number;
  node: ReactNode;
}

export interface HomeSlotsProps {
  slots: ReadonlyArray<HomeSlot>;
  /** Rendered instead of the list when no slot is registered (the "Em breve" card). */
  empty: ReactNode;
}

/**
 * Ordered home-slot renderer (D-42, UI consideration E04): the registered widgets stack with `gap-6`
 * below the welcome block; a slot whose node is `null` occupies nothing; with zero slots the `empty`
 * node renders in their place. Server-safe — no hooks, no client code.
 */
export function HomeSlots({ slots, empty }: HomeSlotsProps) {
  if (slots.length === 0) return <>{empty}</>;
  const ordered = [...slots].sort((a, b) =>
    a.order === b.order ? a.key.localeCompare(b.key) : a.order - b.order,
  );
  return (
    <div className="flex flex-col gap-6">
      {ordered.map((slot) => (slot.node === null ? null : <div key={slot.key}>{slot.node}</div>))}
    </div>
  );
}
