---
sketch: 001-phase-02-designed-screens
name: phase-02-designed-screens
phase: 2
question: "Do the screens the prototype lacks read as the prototype's own language — same tokens, geometry and copy — in light and dark, under any tenant brand?"
screens:
  - desktop-shell-home
  - settings
  - tenant-list
  - tenant-list-empty
  - new-tenant
  - tenant-page-marca
  - tenant-page-modulos
  - tenant-page-dominios
  - tenant-page-admins
  - tenant-page-status
  - accept-invite
  - expired-invite
  - suspended
  - offline
  - install-hint
  - platform-shell-mobile
  - feedback
status: approved
approved: true
approved_by: "Igor Vilas Boas (product owner)"
approved_at: "2026-09-16"
approval_kind: provisional
approval_note: "Provisional approval by the product owner; the team's designer will review the platform-panel screens later. Any future designer deltas are a follow-up, not a blocker for coding the screens now."
changes_requested: []
winner: null
tags: [phase-02, design-review, D-33, UI-04, platform-panel, desktop-shell, auth, pwa]
---

# Sketch 001: Phase 2 [designed] screens (D-33 review gate)

## Design Question

`reference/frontend-design/` covers the member shell, the auth pages and the primitives. The
screens it lacks were specified in `02-UI-SPEC.md` in the prototype's language and are rendered here
as ONE static HTML file so the design team can approve them **before** they are coded (UI-04, D-33):
the desktop shell (rail + column), Settings, the whole platform panel (tenant list, new tenant, the
five tabs of the tenant page), accept-invite, expired-invite, suspended/unavailable, offline, the iOS
install hint, the panel on a phone, and the feedback surfaces (toasts, error card, not-found).

## How to View

```
open .planning/sketches/001-phase-02-designed-screens/index.html
```

Self-contained (no build, no React, no external JS). Manrope loads from Google Fonts; without
network the system fallback renders. The single file can be sent to the design team as is, together
with `.planning/phases/02-tenant-shell-branding-platform-panel/02-UI-SPEC.md`.

Toolbar (mockup-only chrome at the top):

- **Tema escuro / Tema claro** — toggles `data-theme` on `<html>` (the `rede_theme` cookie in the app);
  every "Tema" Switch in the screens mirrors it.
- **Cor primária / Cor secundária** and the presets — set the five `--brand-*` variables exactly as
  `brandStyleVars()` does, on the tenant-branded surfaces (`[data-brand-scope]`). The platform panel
  chrome stays neutral platform blue on purpose (it lives on the platform host); only the `BrandPreview`
  inside the forms takes the picked colours, with the D-41 contrast readout and the "Contraste baixo"
  warning (try the yellow preset).
- The section links jump to each screen.

## What to Look For

1. **Language** — does each screen feel like the prototype (12/14/16/24 type, 4px spacing, 12px
   radii, 44px targets, soft pills, glass BottomNav)? Anything that reads as "another design system"?
2. **Visual anchors** — one accent element per screen (UI-SPEC "Visual Anchors"): "Novo tenant" on the
   list, the `BrandPreview` on New tenant / Marca, the Switch column on Módulos, the primary domain
   card on Domínios, the invite pill on Admins, the single status CTA, the 56px Share circle on the
   install sheet. Is the eye landing where intended?
3. **Dark mode** — cards get a hairline border, the accent flips to the lightened `primaryDark`, the
   panel stays readable; check the `BrandPreview` mini-shells keep their own theme when the page is
   dark.
4. **Any tenant brand** — pick the purple, green, red and yellow presets: does everything brand-bound
   recolour (CTA, active rail item, active BottomNav chip, Tabs underline, Switch on-state, focus ring,
   "Primário" pill, section micro-headers) while cards, borders and body text stay neutral?
5. **Copy** — every string comes verbatim from the UI-SPEC Copywriting Contract (member app says
   "comunidade", the panel says "tenant"). Flag any wording to change; it lands in the pt-BR catalog.
6. **Desktop rail** — 240px, logo box h-12, nav items h-11, bottom group (Notificações, Suporte,
   Configurações, Tema, Sair). Is the hierarchy right without a TopBar?
7. **Domain card** — DNS table density, copy buttons, the three states (Aguardando DNS, Verificado,
   Expirado) and the disabled "Remover" on the primary host.

Not in scope of this review: the ported prototype screens (login, sign-up, feed) and real logos —
the mark here is a placeholder generated from the tenant's initials (the "square logo" case; a wide
logo hides the name next to it, D-26).

## Review outcome

**Approved (provisional) — Igor Vilas Boas, product owner, 2026-09-16.** Recorded from the D-33
checkpoint reply in `02-04-PLAN.md`: the product owner approved every screen in this mockup with no
change list (`changes_requested: []`), so `02-UI-SPEC.md` carries no "Design review deltas" section.

The approval is **provisional**: the team's designer has not reviewed these screens yet and will do
so later, the platform-panel screens in particular. That review is a **follow-up, not a blocker** —
the [designed] screens may be coded now against this mockup and the UI-SPEC. When the designer's
deltas arrive, record them in `changes_requested`, apply them to `index.html` and append a
"## Design review deltas" section to `02-UI-SPEC.md`; the coded screens then absorb them as a
polish pass.

Reply on record (pt-BR): "todo design dessa pagina de super_admin aprovado, nao estou preocupado
muito aqui porque depois irá passar na mao do designer da equipe. Entao por agora está tudo ok e
aprovado por mim".
