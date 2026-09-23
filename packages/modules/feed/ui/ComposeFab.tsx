'use client';

import { Plus } from 'lucide-react';

/**
 * The mobile floating create control (D-57, UI-D-17, UI-SPEC §Feed surface contract "Composer
 * entry").
 *
 * **It is a LINK, not a button.** The composer is a full-screen ROUTE (`/criar`, never a bottom
 * sheet — a long video upload must not live in a layer that can be dismissed by accident), so the
 * affordance that opens it is a navigation. That is also why it has no pending state and no failure
 * surface of its own (UI-SPEC E15/loading, E15/error): nothing is submitted here, and a permission
 * that changed between render and tap lands on the composer route's own refusal rather than on a
 * toast this control would have to invent.
 *
 * **Visibility is a BOOLEAN PROP, never a role comparison.** The host reads the composed
 * `feed.post.create` permission off the bootstrap — the same value `requirePermission` evaluates on
 * the API (FEED-08, R-P8) — so flipping `tenant_modules['feed'].settings.postingPolicy` to
 * `'members'` turns every member into an author with no change in this file.
 *
 * **Desktop renders nothing** (`md:hidden`, UI-D-17): a thumb-reach control floating over a centred
 * column next to a rail has no rationale, and it would collide with the desktop toast anchor.
 * `FeedList` draws the header-row "Criar publicação" button there instead.
 *
 * The bottom offset clears the floating `BottomNav` pill BY CONSTRUCTION rather than by trial: the
 * nav sits at `calc(var(--safe-bottom) + 8px)` with an `h-11` pill plus padding, and `5.25rem`
 * above the safe area puts this control's 56px circle clear of it on every notch geometry.
 */
export type ComposeFabProps = {
  /** `/criar` — built by the host; the module knows no route table (MOD-02). */
  href: string;
  /** Accessible name ("Criar publicação"); the module ships no words (PWA-03). */
  label: string;
  /**
   * False renders NOTHING at all. Two reasons a host passes false: the viewer may not publish, and
   * the feed's empty-state CTA is on screen — the card's own brand button is then the single brand
   * fill in the viewport (UI-SPEC §Visual Anchors, "Empty feed").
   */
  visible: boolean;
};

export function ComposeFab({ href, label, visible }: ComposeFabProps) {
  if (!visible) return null;

  return (
    <a
      href={href}
      aria-label={label}
      data-compose-fab
      className="fixed right-4 bottom-[calc(var(--safe-bottom)+5.25rem)] z-40 grid h-14 w-14 place-items-center rounded-full bg-brand text-on-brand shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:hidden"
    >
      <Plus aria-hidden size={24} />
    </a>
  );
}
