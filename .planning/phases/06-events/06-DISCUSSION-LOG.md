# Phase 6: Events - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-25
**Phase:** 06-events
**Areas discussed:** Eventos tab & detail page, RSVP rules, Check-in: trust vs code, Admin authoring & cancel

---

## Eventos tab & detail page

| Option | Description | Selected |
|--------|-------------|----------|
| Próximos / Passados chips | Two chips, one keyset query each (the 05.1 Ativas/Arquivadas pattern); prototype poster card with the member's own state as its pill | ✓ |
| Prototype rails, reframed | Horizontal poster rails "Você vai / Próximos / Passados", capped with "Ver todos"; rails don't page | |
| One scroll, two sections | Próximos on top, Passados below on one page; past list capped or unbounded | |

**User's choice:** Próximos / Passados chips

| Option | Description | Selected |
|--------|-------------|----------|
| Stays in place, 'Cancelado' pill | Stays in Próximos/Passados with a pill; detail shows a banner, RSVP/check-in disabled; the only signal in V1 (no cancel notifications) | ✓ |
| Hidden from lists | Only reachable by direct link | |
| Visible only to people who confirmed | Per-member list predicate | |

**User's choice:** Stays in place, 'Cancelado' pill

| Option | Description | Selected |
|--------|-------------|----------|
| Next-event card on Início | Home-slot card for the next upcoming event; hidden when none; doubles as check-in shortcut on the day | ✓ |
| Only for events I confirmed | Card only when the member answered "Vou" | |
| Eventos tab only | Início stays stories + feed | |

**User's choice:** Next-event card on Início

| Option | Description | Selected |
|--------|-------------|----------|
| Address + 'Abrir no Maps' | Venue + address text and a button opening the device's maps app; no iframe | ✓ |
| Embedded map + 'Abrir no Maps' | Port the prototype's keyless Google Maps iframe; CSP frame-src + LGPD concerns | |
| You decide | Claude picks during research | |

**User's choice:** Address + 'Abrir no Maps'

---

## RSVP rules

| Option | Description | Selected |
|--------|-------------|----------|
| Until the event starts | Changeable freely until start; then only check-in (walk-in); locked after check-in | ✓ |
| Until the event ends | "Vou" still possible during the event | |
| Until check-in opens | RSVP closes 1 h before the start | |

**User's choice:** Until the event starts

| Option | Description | Selected |
|--------|-------------|----------|
| Two buttons: Vou / Não vou | Segmented pair; "Não vou" is a recorded answer | ✓ |
| One 'Confirmar presença' button | Single toggle; cancel stored as not going | |

**User's choice:** Two buttons: Vou / Não vou

| Option | Description | Selected |
|--------|-------------|----------|
| Number only | "23 confirmados" on card and detail; who is going stays private | ✓ |
| Faces + number | Avatar stack + "Ana, João e mais 21 vão" | |
| Number, plus faces for people I follow | Only meaningful after 05.3's follow graph | |

**User's choice:** Number only

| Option | Description | Selected |
|--------|-------------|----------|
| Only members who confirmed | URL left out of the payload until "Vou" | ✓ |
| Every member | Visible to everyone in the tenant | |
| Confirmed, and only near the start | Revealed when the check-in window opens | |

**User's choice:** Only members who confirmed
**Notes:** Refined at the end of the discussion (see "Online walk-in" below): the confirmed-only gate applies before the check-in window; during the window `Entrar` works for every member and an unconfirmed one is a walk-in. The raw URL is never shown; members always go through the app's `/entrar` route.

---

## Check-in: trust vs code

| Option | Description | Selected |
|--------|-------------|----------|
| Venue code | Short per-event code only the admin sees; said/written at the venue; member types it (prototype's typed-code field, no QR/camera) | ✓ |
| Plain self check-in button | Works from anywhere in the window; "claimed to be there" | |
| Admin chooses per event | "Exigir código" switch on the form; two flows | |

**User's choice:** Venue code

| Option | Description | Selected |
|--------|-------------|----------|
| 1 h before start → event end | Fixed platform rule; multi-day events stay open to the end | ✓ |
| 1 h before → 1 h after start | Tight window; late arrivals locked out | |
| Admin sets it per event | Two extra form fields | |

**User's choice:** 1 h before start → event end

| Option | Description | Selected |
|--------|-------------|----------|
| Tapping 'Entrar' checks you in | Recording the check-in, then forwarding to the meeting | ✓ |
| Separate check-in button | Calendar joiners never counted | |
| No check-in for online events | RSVP only | |

**User's choice:** Tapping 'Entrar' checks you in

| Option | Description | Selected |
|--------|-------------|----------|
| The app's 'entrar' link | Calendar carries /eventos/{id}/entrar; counts check-in, gate checked at click time, survives link edits | ✓ |
| The raw meeting link | Calendar carries the Zoom/Meet URL itself | |

**User's choice:** The app's 'entrar' link

---

## Admin authoring & cancel

| Option | Description | Selected |
|--------|-------------|----------|
| Title-row 'Criar evento' button | D-86 pattern; full-screen /eventos/novo; edit at /eventos/[id]/editar | ✓ |
| Floating button on /eventos | ComposeFab over posters | |
| From /criar, as a post type | "Post / Evento" switch in the post composer | |

**User's choice:** Title-row 'Criar evento' button

| Option | Description | Selected |
|--------|-------------|----------|
| Required, prefilled start + 2 h | End drives Passados, check-in close and calendar end | ✓ |
| Optional | Missing end = start + fixed duration | |

**User's choice:** Required, prefilled start + 2 h

| Option | Description | Selected |
|--------|-------------|----------|
| Edit freely; cancel is reversible; no delete | RSVPs kept; "Reativar" until start; history always survives | ✓ |
| Edit freely; cancel is final; no delete | Mistaken cancel means re-creating the event | |
| Also allow delete when nobody RSVP'd | "Excluir" for events with zero answers | |

**User's choice:** Edit freely; cancel is reversible; no delete

| Option | Description | Selected |
|--------|-------------|----------|
| Chips: Confirmados / Presentes / Não vão | Admin-only "Participantes" screen; counts per chip; walk-ins tagged; venue code at the top | ✓ |
| One list with a status pill per row | Alphabetical, all answers | |
| Grouped sections on one page | Can't page per group | |

**User's choice:** Chips: Confirmados / Presentes / Não vão

---

## Online walk-in (conflict resolution)

Raised by Claude before writing CONTEXT.md: "link only for confirmed" plus "RSVP closes at start" locked out an unconfirmed member of an online event, while EVENT-04 allows walk-ins in person.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes: 'Entrar' works for everyone in the window | Before the window only confirmed members get Entrar; during the window any member can, recorded as a walk-in | ✓ |
| No: confirmed members only | Online events have no walk-ins | |

**User's choice:** Yes: 'Entrar' works for everyone in the window

---

## Claude's Discretion

- Attendance row shape (walk-in vs confirmed-then-checked-in history), the secrets store for the meeting URL and venue code, bounded code guessing, code regeneration, `https:`-only URLs with no open redirect.
- `/entrar` as a GET with a side effect: prefetch/SW/unfurler safety, behaviour outside the window and after the end.
- What "N confirmados" counts, what past events show, whether staff RSVPs count.
- Domain event names and Phase-7-ready payloads; permission keys; whether `support_tenant` reads attendance.
- Prototype extras (keep countdown and "Acontecendo agora"; drop type label, vagas, ticket, certificates, programme, "Bom saber", photos, `/my-events`).
- Check-in flow shape (sheet vs route) and the boarding-pass confirmation; optional cover with brand-gradient fallback; form date/time inputs; empty states; nav order and the tab budget after 05.3/05.5; home-slot order; desktop composition; test strategy and seed fixtures.

## Deferred Ideas

- Seeing who's going (faces), an embedded map, per-event check-in windows, deleting events, a per-event "require code" switch, a "Meus eventos" view, events inside a community.
- Already V2: QR/geofence and admin manual check-in, update/cancel notifications, CSV/maybe/capacity/waitlist. Reminders (EVENT-07) are Phase 7.
