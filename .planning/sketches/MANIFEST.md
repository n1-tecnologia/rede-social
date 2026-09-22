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
- `packages/ui/src/styles/tokens.css` — the real token file (two-layer neutrals + tenant brand,
  plus the Phase 4 `--color-like`)

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | [phase-02-designed-screens](001-phase-02-designed-screens/README.md) | Do the prototype-less Phase 2 screens (desktop shell, settings, platform panel, accept-invite, suspended/offline, install hint) read as the prototype's own language in light/dark under any tenant brand? | approved (provisional) by the product owner, 2026-09-16 — designer review is a follow-up (D-33) | phase-02, design-review, platform-panel, desktop-shell |
| 002 | [phase-04-designed-screens](002-phase-04-designed-screens/README.md) | Do the six prototype-less Phase 4 surfaces (composer, edit screen, FAB + desktop compose CTA, link-preview card, attachment row, post "…" menu) read as the prototype's own language in light/dark under any tenant brand? | pending | phase-04, design-review, D-33, UI-04, composer, feed |
