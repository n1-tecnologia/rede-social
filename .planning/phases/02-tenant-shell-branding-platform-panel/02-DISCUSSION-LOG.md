# Phase 2: Tenant Shell, Branding & Platform Panel - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-14
**Phase:** 2-tenant-shell-branding-platform-panel
**Areas discussed:** Tenant branding model, Platform panel (tenant creation & first admin), Custom domains & branded e-mails, App shell & desktop layout

Questions were asked in pt-BR (user's working language); options are summarised here in English.

---

## Tenant branding model

### Which colors can a tenant define?

| Option | Description | Selected |
|--------|-------------|----------|
| Primary + secondary (Recommended) | Mirrors the prototype's accent / accent-secondary; bg, text, borders stay neutral tokens; gradients, tints, on-primary text derived with `color-mix` + contrast calc | ✓ |
| Primary only | Secondary derived automatically; simpler, less expressive | |
| Primary + secondary + background | Tenant also picks the surface color; more contrast pairs to validate, complicates dark mode | |

**User's choice:** Primary + secondary

### How is the tenant logo displayed?

| Option | Description | Selected |
|--------|-------------|----------|
| Image as-is (Recommended) | Colored PNG/SVG rendered directly; drops the prototype's `.brand-ig-mark` monochrome mask | ✓ |
| Monochrome mask tinted with primary | Prototype pattern; always harmonious but requires a monochrome logo | |
| Both: colored + optional mono | Two uploads, two fallback rules | |

**User's choice:** Image as-is

### How does `super_admin` upload the logo before the media pipeline (Phase 3)?

| Option | Description | Selected |
|--------|-------------|----------|
| Direct upload to the `branding` bucket (Recommended) | Signed upload URL from the platform lane (kernel), browser → public bucket, API derives icons with `sharp`; Phase 3 reuses the pattern | ✓ |
| Multipart through the API | Simpler now, creates an exception to "uploads never pass through the API" | |
| External URL only this phase | No storage infra now; icons must fetch a remote image; pilot depends on external hosting | |

**User's choice:** Direct upload to the `branding` bucket

### Favicon and PWA icons: derived or uploaded?

| Option | Description | Selected |
|--------|-------------|----------|
| Derived from the logo with optional override (Recommended) | favicon.ico, 192/512, maskable on primary with safe margin, apple-touch; optional square icon replaces the set | ✓ |
| Always derived | One upload; horizontal logos may look bad as app icons | |
| Always uploaded separately | Always good result, more provisioning friction | |

**User's choice:** Derived with optional override
**Notes:** User moved on without more questions; login page fully branded before auth is locked by roadmap criterion 1.

---

## Platform panel: tenant creation & first admin

### How does the first `admin_tenant` join from the e-mail invitation?

| Option | Description | Selected |
|--------|-------------|----------|
| Invite link + "aceitar convite" screen (Recommended) | Membership `invited` + Supabase `inviteUserByEmail`; screen on the tenant domain sets password and records both consents (AUTH-04); reuses `/auth/confirm` and `/redefinir-senha` logic | ✓ |
| Public sign-up + automatic promotion | Admin signs up like a member and is promoted on e-mail match; less new code, no "you are admin" screen | |
| Initial password set by super_admin | Shared out of band; least secure, no consent recorded | |

**User's choice:** Invite link + accept-invite screen

### When is the admin invite sent, given the link must open on the tenant domain?

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic on primary-domain verification (Recommended) | E-mail collected at creation, "Convite pendente — aguardando domínio"; sent when the primary domain verifies; "Reenviar convite" always available; immediate if a verified domain exists | ✓ |
| Manual only via "Enviar convite" | No automation; Rede Social must remember to come back | |
| Immediate, link on the platform domain | Opens an exception to D-21 | |

**User's choice:** Automatic on verification

### Tenant creation flow in the panel?

| Option | Description | Selected |
|--------|-------------|----------|
| Single form + settings page (Recommended) | Name, slug (suggested, editable, immutable after), primary/secondary, modules (all on), admin e-mail → tenant page with tabs Marca / Módulos / Domínios / Admins / Status | ✓ |
| 4-step wizard | Guides a new operator; upload forces a draft tenant at step 1; more screens to design | |
| Minimal create (name + slug) | Everything else later; ROLE-03 satisfied only if the operator completes it | |

**User's choice:** Single form + settings page

### How does the UI-04 design review work for panel screens (pattern for Phases 4-8)?

| Option | Description | Selected |
|--------|-------------|----------|
| UI-SPEC + HTML mockup approved before coding (Recommended) | `/gsd-ui-phase 2` + `/gsd-sketch` mockup shared with design; only panel screens wait; no Vercel Preview dependency | ✓ |
| Async review on the running app | Faster start, more rework risk | |
| Design team draws in the prototype first | Phase blocked on the design team's schedule | |

**User's choice:** UI-SPEC + HTML mockup approved before coding
**Notes:** Accepted by moving on: panel is desktop-first but responsive; `super_admin` can suspend/reactivate a tenant from the Status tab.

---

## Custom domains & branded e-mails

### How does the panel track domain verification?

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic polling + "Verificar agora" (Recommended) | Vercel registration, DNS records shown, pg-boss poller (~10 min up to 7 days), on verified → `verified_at`, allow-list, invite | ✓ |
| Manual "Verificar" button only | No background job; invite depends on someone clicking | |
| Vercel webhook/event | Elegant if the event exists; fragile otherwise | |

**User's choice:** Automatic polling + manual button

### What does an alias host do when accessed?

| Option | Description | Selected |
|--------|-------------|----------|
| Redirect (308) to the primary (Recommended) | Single origin serves the app; PWA/cookies/push are per origin; `www.` → apex | ✓ |
| Serve the app on any verified host | Fragments installs/sessions, complicates allow-list | |
| One host per tenant this phase | Schema already supports aliases; `www.` becomes a pilot problem | |

**User's choice:** 308 to primary

### How do auth e-mails get the tenant brand?

| Option | Description | Selected |
|--------|-------------|----------|
| Send Email Hook → API renders + sends via Resend (Recommended) | Tenant from membership or `redirect_to` host; one template engine reused in Phase 7; Phase 1 flows unchanged; local via `[auth.hook.send_email]` | ✓ |
| Supabase templates + user metadata | Zero infra; one layout for all; metadata sync on brand change | |
| API generates links and sends directly | Full control; `/esqueci-senha` must stop using `resetPasswordForEmail` | |

**User's choice:** Send Email Hook → API → Resend

### Sender name and Rede Social signature?

| Option | Description | Selected |
|--------|-------------|----------|
| Sender = tenant name; discreet "via Rede Social" footer (Recommended) | From `{Tenant} <no-reply@mail.…>`, tenant logo/name/color in body, small footer "Enviado pela plataforma Rede Social" | ✓ |
| Sender = tenant name; no Rede Social mention | Total white-label; no hint of the operator | |
| Sender = "{Tenant} via Rede Social" | Marketplace style; clutters the From field | |

**User's choice:** Tenant sender + discreet footer
**Notes:** Accepted by moving on: only verified hosts resolve in `proxy.ts`; removing a domain removes it from Vercel and the allow-list; local/dev uses a fake provider adapter that verifies immediately.

---

## App shell & desktop layout

### Desktop layout?

| Option | Description | Selected |
|--------|-------------|----------|
| Left rail + centred column (Recommended) | Rail with logo, registry items, bell/chat/avatar; content column ~640-720 px; mobile keeps TopBar + floating BottomNav | ✓ |
| Top bar with tabs + centred column | TopBar overloaded with logo + tabs + bell + chat + avatar | |
| Narrow centred column (mobile enlarged) | Cheap; wastes the screen; weak on "real desktop layout" | |

**User's choice:** Left rail + centred column

### With every module on, what becomes a tab and what stays in the TopBar?

| Option | Description | Selected |
|--------|-------------|----------|
| Início, Comunidades, Eventos, Perfil + bell & chat in TopBar (Recommended) | 4 tabs; stories is a strip on Início; notifications and chat are TopBar slots with badges; Perfil is kernel and always present | ✓ |
| Início, Comunidades, Eventos + bell, chat, avatar in TopBar | Faithful to the prototype; 3 tabs when all on | |
| 5 tabs incl. Notificações; chat in TopBar | Instagram/Facebook pattern; tight pill on small screens | |

**User's choice:** 4 tabs + bell/chat in TopBar

### Dark mode in V1?

| Option | Description | Selected |
|--------|-------------|----------|
| Light only in V1, tokens ready for dark (Recommended) | Avoids deciding per-tenant dark accents now | |
| Light + dark with user toggle | Port ThemeContext; dark primary derived automatically; contrast validated in both modes | ✓ |
| Follow system, no toggle | Same token work, less UI, no user escape hatch | |

**User's choice:** Light + dark with user toggle (went against the recommendation — dark mode is a V1 deliverable)

### What does the member see after login this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Kernel home at `/inicio` with module slots (Recommended) | Branded welcome + "Em breve" now; later modules register widgets (stories strip, feed list); amends D-07 | ✓ |
| `/feed` as home owned by the feed module | Literal D-07; placeholder at `/feed` until Phase 4 | |

**User's choice:** Kernel home at `/inicio` with slots
**Notes:** Accepted by closing: TopBar shows the logo image with the display name as aria-label/title; theme toggle in a minimal settings page next to "Sair"; iOS install hint built but only surfaced in Phase 7.

---

## Claude's Discretion

- Shape of the public brand answer (extend `hostTenantSchema` vs sibling route) and its caching/invalidation.
- Domain-provider adapter interface, Supabase Management API allow-list call, secret placement, TXT challenge, polling cadence, job idempotency.
- Send-email hook path, signature verification, template engine, local mail transport, persisted derived colors for e-mail.
- Registry extensions (`nav.placement`, home slots, settings rows), `@rede-social/ui` token layout, which extra primitives to port now.
- Contrast algorithm and thresholds (warn + confirm on failure).
- Suspended-tenant envelope code and copy; platform panel URL space; list filters.
- Service-worker strategy, offline page, update prompt; theme cookie; invite expiry.
- pt-BR catalog namespacing; test strategy for brand isolation, static-route check, domain → invite e2e.

## Deferred Ideas

- ADMIN-01 tenant-side branding editor (Phase 8) reusing this phase's endpoints.
- Android install prompt UX + iOS hint wiring (Phase 7).
- Non-auth e-mail notifications/digests (Phase 7).
- Per-tenant sending domain (V2).
- `super_admin` "view as tenant" impersonation.
- Vercel domain-verified webhook instead of polling.
- Multiple admins at creation, invite expiry customisation, tenant deletion/archival (Phase 8 / V2).
- Carried from Phase 1: "Sair de todos os aparelhos", per-tenant e-mail confirmation toggle, OTP recovery.
