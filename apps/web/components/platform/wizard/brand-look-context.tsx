'use client';

import { createContext, useContext } from 'react';
import type { ButtonColors, DarkColors, FontColors, LookFields } from '@/lib/bg-tone';

/** The look's colours as the previews show them: the last VALID ones (a half-typed hex never). */
export type PreviewColors = {
  darkColors: DarkColors;
  fontColors: FontColors;
  buttonColors: ButtonColors;
};

/**
 * What the look's cards edit (`BackgroundTonePicker`, `DarkColorsCard`, `ButtonColorsCard`,
 * `TitleFontPicker` with `FontColorFields`), whoever holds it: the new-tenant wizard's draft
 * (`TenantDraftProvider`, whose own value has this very shape) or the Marca tab's unsaved look
 * (`BrandLookProvider`). The cards read and write the look through this and nothing else, so the
 * same cards serve the creation and the existing tenant (2026-10-03).
 */
export type BrandLookValue = {
  /**
   * The look as the fields hold it (what the owner TYPES, a half-typed hex included, so a field
   * keeps it), with the name the samples draw.
   */
  draft: LookFields & { displayName: string };
  /** The last VALID colour pair: the automatic colours derive from it. */
  colors: { primary: string; secondary: string };
  /** The last VALID look colours, what the previews and the samples show. */
  previewColors: PreviewColors;
  /** The logo, when there is one: the samples drop the app name, as the top bar does. */
  logo: { url: string } | null;
  update: (patch: Partial<LookFields>) => void;
};

export const BrandLookContext = createContext<BrandLookValue | null>(null);

export function useBrandLook(): BrandLookValue {
  const value = useContext(BrandLookContext);
  if (!value) throw new Error('useBrandLook outside a look provider');
  return value;
}

/**
 * The look being edited when a provider is above, `null` otherwise: the Marca tab's colours card
 * paints it on its `BrandPreview` frames when the look editor wraps the tab.
 */
export function useOptionalBrandLook(): BrandLookValue | null {
  return useContext(BrandLookContext);
}
