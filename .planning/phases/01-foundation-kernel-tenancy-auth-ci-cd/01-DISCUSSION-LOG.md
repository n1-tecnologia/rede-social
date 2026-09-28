# Phase 1: Foundation - Kernel, Tenancy, Auth & CI/CD - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-11
**Phase:** 1-foundation-kernel-tenancy-auth-ci-cd
**Areas discussed:** Sign-up link & consent, Session/login/logout/blocking, Environments/branches/seed/e-mail, Module registry & kernel

---

## Sign-up link & consent

### Public sign-up link format

| Option | Description | Selected |
|--------|-------------|----------|
| `/cadastro/{slug}` | pt-BR dedicated route, readable slug, login stays at `/entrar` | ✓ |
| `/{slug}/cadastro` + `/{slug}/entrar` | Slug prefixes every public route; branded login but two ways to reach login | |
| `/cadastro?t={token}` | Opaque signed token; revocable but ugly and not reconstructible by the admin | |

**User's choice:** `/cadastro/{slug}`

### Sign-up form fields

| Option | Description | Selected |
|--------|-------------|----------|
| Name, e-mail, password | Minimum for identity + membership; show-password toggle instead of confirm | ✓ |
| Name, e-mail, password, confirm password | Prototype minus username | |
| Name, e-mail, phone, password | Phone for admin contact; adds a profile column now | |

**User's choice:** Name, e-mail, password

### Consent UX and recording

| Option | Description | Selected |
|--------|-------------|----------|
| Two versioned checkboxes | Tenant rules (bottom sheet) + Rede Social terms/privacy; `consent_records` with kind, version, timestamp, IP | ✓ |
| One combined checkbox | Less friction, single record; weaker for LGPD | |
| Intermediate rules screen | Full-screen rules with "Aceito e continuar", terms as checkbox | |

**User's choice:** Two versioned checkboxes

### E-mail confirmation and duplicate e-mail

| Option | Description | Selected |
|--------|-------------|----------|
| No confirmation in pilot; duplicate blocked with clear message | Autoconfirm, signed in after sign-up; generic pt-BR message + link to `/entrar`; cross-tenant duplicate logged as V2 signal | ✓ |
| Mandatory confirmation | Link before first login; depends on SMTP from day 1 | |
| No confirmation; duplicate from other tenant joins new tenant | Relaxes one-tenant-per-user now; contradicts ROLE-02 | |

**User's choice:** No confirmation in pilot; duplicate blocked with clear message

---

## Session, login, logout & blocking

### Session duration

| Option | Description | Selected |
|--------|-------------|----------|
| Indefinite while the app is used | 1 h access token, non-expiring refresh token (Supabase default) | ✓ |
| Expires after 30 days idle | Inactivity time-box | |
| Expires after 7 days idle | Conservative | |

**User's choice:** Indefinite while the app is used

### Tenant memory and post-login landing

| Option | Description | Selected |
|--------|-------------|----------|
| Tenant cookie + minimal `/inicio` page | `tenant_slug` cookie (1 year) from `/cadastro/{slug}`; `/entrar` shows tenant name; `/inicio` renders `/me/bootstrap` + Sair | ✓ |
| Query param `?t={slug}` carried between screens | No cookie; context lost on direct URL entry | |
| No tenant memory; neutral platform login | Contradicts AUTH-01 round-trip | |

**User's choice:** Tenant cookie + minimal `/inicio` page

### Logout scope and blocked-member handling

| Option | Description | Selected |
|--------|-------------|----------|
| Local logout; blocked sees "acesso suspenso" screen | `signOut` scope local; 403 `MEMBERSHIP_BLOCKED`; dedicated pt-BR screen without reason | ✓ |
| Global logout | Revokes all refresh tokens | |
| Local logout; blocked gets generic error | No dedicated screen; login loop risk | |

**User's choice:** Local logout; blocked sees "acesso suspenso" screen

### Password recovery flow and policy

| Option | Description | Selected |
|--------|-------------|----------|
| E-mail link -> `/redefinir-senha`; min 8 chars | Non-enumerating response; link sets password and signs in; simple strength indicator | ✓ |
| 6-digit OTP by e-mail | Better in installed iOS PWA; more UI | |
| E-mail link; strong policy (12+, upper, number) | Stricter; more friction on mobile | |

**User's choice:** E-mail link -> `/redefinir-senha`; min 8 chars

---

## Environments, branches, seed & e-mail

### Branch model and environment mapping

| Option | Description | Selected |
|--------|-------------|----------|
| `main` = production, PRs = preview/staging | Rename master -> main; repo under n1-tecnologia; PR = Vercel Preview + Cloud Run staging services; merge = prod | ✓ |
| `develop` = staging, `main` = production | Simplified git-flow, two merges per feature | |
| `main` = staging, tag = production | Manual prod via tags; outside PWA-04 wording | |

**User's choice:** `main` = production, PRs = preview/staging

### Production approval and migrations

| Option | Description | Selected |
|--------|-------------|----------|
| Automatic + 1 approval on migrate/API job | Vercel auto; GCP workflow pauses at `migrate-and-deploy-prod` behind GitHub Environment `production`; migration -> API -> worker | ✓ |
| Fully automatic | No gate on the pilot database | |
| Manual approval for everything | Web promote + GCP approval | |

**User's choice:** Automatic + 1 approval on migrate/API job

### Outbound e-mail for recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Resend via Supabase Custom SMTP | Free 3k/month, verified subdomain, both projects | ✓ |
| Brevo via Custom SMTP | 300/day free, pt-BR dashboard | |
| Amazon SES via Custom SMTP | Cheapest at scale; sandbox exit needed | |
| Keep Supabase default SMTP | Only delivers to team addresses | |

**User's choice:** Resend via Supabase Custom SMTP
**Notes:** Rationale surfaced during discussion: Supabase built-in SMTP is restricted to project team members and rate-limited, so recovery would not work for real members.

### Seeding tenants and super_admin

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotent TS seed script with env vars | `pnpm db:seed`: `rede-demo`, `rede-lab`, admin + member each, super_admin from `SUPER_ADMIN_EMAIL`; auto for local/staging, manual `workflow_dispatch` for prod | ✓ |
| Migration SQL with embedded tenants | Credentials in git history; no per-env variation | |
| Temporary protected bootstrap endpoint | Anticipates Phase 2 panel; extra door to remove | |

**User's choice:** Idempotent TS seed script with env vars

### Regions and naming (gate question)

**User's choice:** "Próxima área", accepting the stated defaults: GCP `southamerica-east1`, Supabase `sa-east-1`, projects `rede-social-staging` / `rede-social-prod`, staging web URL = Vercel Preview URL.

---

## Module registry & kernel

### Toggleable modules vs kernel

| Option | Description | Selected |
|--------|-------------|----------|
| Toggleable: feed, communities, stories, events, chat, notifications; kernel: tenancy, auth, profiles, media, moderation, platform | Registry ships the 6 keys in Phase 1 | ✓ |
| Everything toggleable | Needs `dependsOn` validation and panel guards | |
| Only 4 content modules toggleable; chat + notifications always on | Fewer combinations; tenants without support still see chat | |

**User's choice:** 6 toggleable + kernel set

### Default module set and seed configuration

| Option | Description | Selected |
|--------|-------------|----------|
| All 6 on by default; seed: rede-demo all, rede-lab feed + events | Exercises disabled-module 404 from Phase 1 | ✓ |
| Default feed + notifications; rest on demand | Minimal tenant by default | |
| No defaults; super_admin chooses at creation | Panel forces a choice | |

**User's choice:** All 6 on by default; rede-lab partial

### npm scope and layout

| Option | Description | Selected |
|--------|-------------|----------|
| `@rede-social/*` with `apps/{web,api}` and `packages/{core,contracts,ui,config,modules/*}` | Worker from the same API image with `ROLE=worker` | ✓ |
| `@rede-social/*` same layout | Product-named scope; awkward for reuse | |
| `@rede-social/*` with separate `apps/worker` | Two images to keep in sync | |

**User's choice:** `@rede-social/*` with shared API/worker image

### Module template deliverable

| Option | Description | Selected |
|--------|-------------|----------|
| Real throwaway example module, registered and tested | Table + RLS, route behind `requireModule`, event, job, minimal UI on `/inicio`; removed in Phase 4 | ✓ |
| Generator script only (`pnpm gen:module`) | No live proof until Phase 4 | |
| Both | Most complete, more cost now | |

**User's choice:** Real throwaway example module

---

## Claude's Discretion

- Exact `/me/bootstrap` payload (follow ARCHITECTURE.md Pattern 3).
- Domain event bus and pg-boss wiring shape.
- API error envelope (stable machine codes required).
- Per-tenant flag cache and boundary-lint tooling choice.
- Supavisor `set_config` + `SET LOCAL ROLE` spike approach and fallback switch.
- Minimal observability (pino fields, optional Sentry).
- Playwright smoke coverage on mobile viewport.
- Regions and project names (defaults accepted by the user).

## Deferred Ideas

- Per-tenant toggle for mandatory e-mail confirmation.
- Phone field on the profile.
- OTP-based password recovery for installed iOS PWA.
- Module generator script.
- Login rate limiting beyond Supabase defaults.
- "Sair de todos os aparelhos" option.
- Tenant-branded auth e-mails (already Phase 2).
