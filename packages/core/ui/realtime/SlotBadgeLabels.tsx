'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { NavBadge } from '../nav';

/**
 * UI-D-253: a TopBar/rail slot's accessible name carries its state ("Notificações, 1 nova"). The
 * kernel ships no words, and a server layout cannot hand a function to a client component, so the
 * host supplies the label function through this context from a client component of its own
 * (`apps/web/components/shell/LiveShell.tsx`). Answer `undefined` to keep the slot's plain label.
 */
export type SlotBadgeLabel = (badge: NavBadge, count: number) => string | undefined;

const SlotBadgeLabelsContext = createContext<SlotBadgeLabel | null>(null);

export interface SlotBadgeLabelsProviderProps {
  value: SlotBadgeLabel;
  children: ReactNode;
}

export function SlotBadgeLabelsProvider({ value, children }: SlotBadgeLabelsProviderProps) {
  return (
    <SlotBadgeLabelsContext.Provider value={value}>{children}</SlotBadgeLabelsContext.Provider>
  );
}

/** The host's label function, or `null` outside a provider (the slot then keeps its plain label). */
export function useSlotBadgeLabel(): SlotBadgeLabel | null {
  return useContext(SlotBadgeLabelsContext);
}

/**
 * The slot's accessible name: the host's stateful label while the count is above zero, the plain
 * label at zero or when the host has none for this badge.
 */
export function slotAccessibleName(
  label: string,
  badge: NavBadge | undefined,
  count: number,
  labelFor: SlotBadgeLabel | null,
): string {
  if (!badge || count <= 0 || !labelFor) return label;
  return labelFor(badge, count) ?? label;
}
