/**
 * The "Complete seu perfil" popup's VISIT marker (D-02 as amended on 2026-10-02: the nudge is a
 * popup that rises over Início on arrival, no longer a card in the page). The tab's
 * `sessionStorage` holds the membership id of whoever already answered the popup in this visit.
 *
 * WHO sees it stays the server's `needsNudge` (R-13: no photo or no bio, and never dismissed on the
 * old card); this module only decides WHEN: once per visit to the app, the way the reference app
 * asks on every arrival after a login (`socialroberth-completo`, `lib/convite-perfil.ts`).
 * sessionStorage IS the visit: a reload or a return to Início keeps the answer, a closed tab
 * forgets it, and a SUBMITTED sign-in clears it on purpose (`RearmProfileNudge`, inside the forms
 * of `/entrar`, `/cadastro` and `/aceitar-convite`), so the next sign-in asks again while the
 * profile is still incomplete. An entry page that is only shown, as Back from Início shows
 * `/entrar`, keeps it. A UX preference, never authorisation.
 *
 * The membership id rather than a bare flag: a different member signed in on the same tab without
 * submitting one of those forms (the session cookies are shared by every tab, sessionStorage is
 * not) still gets their own popup.
 *
 * Every access sits in try/catch and runs ONLY in an effect or a handler: the server has no
 * sessionStorage. Storage that cannot be read means NO popup, never a popup on every visit.
 */

export const PROFILE_NUDGE_KEY = 'rede-social:convite-perfil';

/**
 * How long Início settles before the popup rises (the reference's `ESPERA`). Pinned by the unit
 * test: the e2e waits that prove the popup's ABSENCE (1 s, 1.5 s) assume it.
 */
export const PROFILE_NUDGE_DELAY_MS = 500;

/** Whether the popup is due in this visit for `membershipId`; `false` when storage is blocked. */
export function profileNudgeDue(membershipId: string): boolean {
  try {
    return window.sessionStorage.getItem(PROFILE_NUDGE_KEY) !== membershipId;
  } catch {
    return false;
  }
}

/** Ends the popup for this visit: "Completar agora", "Mais tarde" and Escape all call it. */
export function endProfileNudge(membershipId: string): void {
  try {
    window.sessionStorage.setItem(PROFILE_NUDGE_KEY, membershipId);
  } catch {
    // Storage that refuses the write: the popup still closes, there is just no answer to keep.
  }
}

/** Makes the popup due again: the entry forms call it on submit, so each sign-in is a new visit. */
export function rearmProfileNudge(): void {
  try {
    window.sessionStorage.removeItem(PROFILE_NUDGE_KEY);
  } catch {
    // Storage blocked: there is no answer to forget.
  }
}
