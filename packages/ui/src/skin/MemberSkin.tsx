import type { ReactNode } from 'react';

/**
 * The member skin's scope (2026-10-26): the academy look of the members area and the store's shop
 * window, in the tenant's colours and the person's theme. It draws `data-member-skin`, the
 * attribute every rule of member-skin.css starts from, and the page's ground under it; the
 * components inside carry the hook classes (`ms-card`, `ms-panel`, ...) that only this scope turns
 * on, so the admin screens, which never render it, keep their look with the very same components.
 *
 * Wrap the OUTERMOST element of a member screen only, once: a sheet or a dialog renders inside the
 * page, so this wrapper never moves, never isolates and never takes a z-index. The root is not
 * positioned; the content sits in a `relative` box painted after the fixed backdrop, with no
 * z-index, so an overlay's `z-[55]` still reaches the top of the page.
 *
 * No directive: a Server Component renders it, and so does a client one.
 */
export interface MemberSkinProps {
  children: ReactNode;
  /** The page's ground (drifting glows and grain). Off for a scope inside another one. */
  backdrop?: boolean;
}

export function MemberSkin({ children, backdrop = true }: MemberSkinProps) {
  return (
    <div data-member-skin="">
      {backdrop ? <MemberBackdrop /> : null}
      <div className="relative">{children}</div>
    </div>
  );
}

/**
 * The page's ground: a fixed layer beside the desktop rail with two brand glows drifting and a fine
 * grain. Decorative only (`aria-hidden`, no pointer events); its look and motion are member-skin.css's.
 */
export function MemberBackdrop() {
  return (
    <div aria-hidden="true" data-testid="member-skin-backdrop" className="ms-backdrop">
      <span className="ms-blob ms-blob-a" />
      <span className="ms-blob ms-blob-b" />
    </div>
  );
}
