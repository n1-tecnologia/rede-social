# Phase 06 — API Coverage Declaration

No external API integration: Phase 6 adds no package or service; it builds first-party `/v1/events` routes and its own `.ics`, and only links out to Google Calendar and maps.

The phase builds the first-party `@tria/module-events`: Drizzle tables, SECURITY DEFINER check-in functions, Hono routes under `/v1/events`, and Next.js screens. It writes the `.ics` file in its own code, and it reaches Google Calendar and the device's maps app only through plain URL templates that the server never calls.

The detector run over this phase's ROADMAP scope returned `{"detected":false,"signals":[]}`. A wider scan over CONTEXT and RESEARCH fired only on the test-command label "API integration command", which names our own integration suite. This file exists so the seal-time re-run, which reads the PLAN.md prose, accepts the reasoned declaration instead of a capability matrix. In that prose, "endpoint", "route", "Google Calendar link", "maps URL" and "meeting URL" describe first-party routes and outbound links, not vendor integrations.

**Reason (one line, required):** every external name in this phase is an outbound link the member's browser opens: the Google Calendar `action=TEMPLATE` URL, the universal maps search URL, and the admin-entered `https:` meeting URL behind `/eventos/{id}/entrar`. The server never fetches, authenticates to or depends on any of them. Covers reuse the already-integrated Phase 3 media broker unchanged, and every automated command pins `VIDEO_PROVIDER=fake`.

*Recorded: 2026-09-25 · plan-phase (standard mode)*
