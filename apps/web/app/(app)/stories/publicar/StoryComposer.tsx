'use client';

/**
 * RED SKELETON — signature only (05-05 Task 3).
 *
 * The prop below is the published contract the failing test in `StoryComposer.test.tsx` asserts
 * against; the body is deliberately inert so the assertions, and not the module loader, are what go
 * red (the 05-04 lesson: with no module at all `check tdd-red-evidence` classifies the run as
 * `fixture_or_load_failure`, which is not RED).
 */

export interface StoryComposerProps {
  /** Where the header's trailing text action points (05-08 creates the destination). */
  historyHref: string;
}

export function StoryComposer(_props: StoryComposerProps) {
  return <div />;
}
