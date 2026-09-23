'use client';

/**
 * RED SKELETON — signature only (05-05 Task 1).
 *
 * The props below are the published contract the failing test in `tests/stories-strip.test.tsx`
 * asserts against; the body is deliberately inert so the assertions, and not the module loader, are
 * what go red (the 05-04 lesson: with no module at all `check tdd-red-evidence` classifies the run
 * as `fixture_or_load_failure`, which is not RED).
 */

/** Which ring a circle wears. `own` is the admin's avatar + `Plus` badge (UI-D-28). */
export type StoryCircleVariant = 'brand' | 'neutral' | 'own';

export interface StoryCircleProps {
  variant: StoryCircleVariant;
  label: string;
  actionLabel: string;
  assetId?: string | null;
  variantWidths?: readonly number[];
  avatarUrl?: string | null;
  href?: string;
  onOpen?: () => void;
  eager?: boolean;
}

export function StoryCircle(_props: StoryCircleProps) {
  return null;
}
