# Sketch Manifest

## Design Direction

The design authority is the design team's prototype (`reference/frontend-design/`, git `05f68b1`):
Manrope, a light `#f5f7fb` ground with white cards, navy text, 12px radii, 44px touch targets, a
floating glass BottomNav, and a single accent colour that is the tenant's brand (D-25). Screens the
prototype does not cover are designed in that same language from the primitives ported into
`@tria/ui` and reviewed with the design team before implementation (UI-04, D-33).

## Reference Points

- `reference/frontend-design/` — the prototype (member shell, auth pages, primitives)
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-UI-SPEC.md` — the UI contract every
  [designed] screen is drawn from (Component Inventory, Copywriting Contract, Visual Anchors)
- `.planning/phases/04-feed/04-UI-SPEC.md` — the Phase 4 contract the [designed] feed surfaces are
  drawn from (Composer / Link preview / Attachment contracts, Copywriting Contract, Visual Anchors)
- `.planning/phases/05-communities-stories/05-UI-SPEC.md` — the Phase 5 contract the [designed]
  stories and community surfaces are drawn from (Stories strip / Story viewer / Story publish &
  history / Community surface contracts, Copywriting Contract incl. the UI-D-46 vocabulary
  amendment, Visual Anchors)
- `.planning/phases/05.2-story-highlights/05.2-UI-SPEC.md` — the Phase 05.2 contract the [designed]
  highlight surfaces are drawn from (UI-D-59..UI-D-80, Component Inventory, Copywriting Contract,
  Screen contracts, Visual Anchors, UI Considerations)
- `.planning/phases/05.3-reels/05.3-UI-SPEC.md` — the Phase 05.3 contract the [designed] Reels
  surfaces are drawn from (UI-D-81..UI-D-99, Component Inventory, Copywriting Contract, Screen
  contracts, Visual Anchors, UI Considerations), with the design team's print
  `.planning/phases/05.3-reels/reels-design.png`
- `packages/ui/src/styles/tokens.css` — the real token file (two-layer neutrals + tenant brand,
  plus the Phase 4 `--color-like`)

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | [phase-02-designed-screens](001-phase-02-designed-screens/README.md) | Do the prototype-less Phase 2 screens (desktop shell, settings, platform panel, accept-invite, suspended/offline, install hint) read as the prototype's own language in light/dark under any tenant brand? | approved (provisional) by the product owner, 2026-09-16 — designer review is a follow-up (D-33) | phase-02, design-review, platform-panel, desktop-shell |
| 002 | [phase-04-designed-screens](002-phase-04-designed-screens/README.md) | Do the six prototype-less Phase 4 surfaces (composer, edit screen, FAB + desktop compose CTA, link-preview card, attachment row, post "…" menu) read as the prototype's own language in light/dark under any tenant brand? | approved (provisional) by the product owner, 2026-09-23 — designer review is a follow-up (D-33) | phase-04, design-review, D-33, UI-04, composer, feed |
| 003 | [phase-05-designed-screens](003-phase-05-designed-screens/README.md) | Do the five prototype-less Phase 5 surfaces (stories strip, story viewer, story publish flow, community create/edit/archive form, pin-a-story flow) read as the prototype's own language in light/dark under any tenant brand? | approved (provisional) by the product owner, 2026-09-23 — designer review is a follow-up (D-33); the gate is now open and the six tasks across 05-04, 05-05, 05-06 and 05-08 are unblocked | phase-05, design-review, D-33, UI-04, stories, communities |
| 004 | [phase-05.2-designed-screens](004-phase-05.2-designed-screens/README.md) | Do the seven prototype-less Phase 05.2 surfaces (Início row with the one tenant circle and its seen ring, community row, manage-highlights screen, edit sheet with cover and add-stories steps, highlight sheet in checklist and single-select modes, the composer's "Destaque" row, the viewer's "Destacar" pill) read as the prototype's own language in light/dark under any tenant brand? | approved (provisional) by the product owner, 2026-09-25 — designer review is a follow-up (D-33); the gate is now open and the 12 UI tasks across plans 05.2-04..05.2-10 are unblocked | phase-05.2, design-review, D-33, UI-04, highlights, stories |
| 005 | [phase-05.3-designed-screens](005-phase-05.3-designed-screens/README.md) | Do the six prototype-less Phase 05.3 Reels surfaces (the lane row with "Todos" plus community lanes, overflowing and hidden; the rail with share added last; the caption collapsed with "… mais" and expanded over the darker veil; the paused and autoplay-blocked badge; the empty and error states; the desktop 9:16 column with the up/down buttons beside it) read as the prototype's own language over video, on mobile and desktop, under any tenant brand? | pending | phase-05.3, design-review, D-33, UI-04, reels |
