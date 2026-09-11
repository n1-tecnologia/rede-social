# Stack Research

**Domain:** Multi-tenant, white-label community / social-network SaaS (mobile-first PWA + responsive desktop)
**Project:** TRIA Rede Social
**Researched:** 2026-09-11
**Confidence:** MEDIUM overall (every version verified against the npm registry on 2026-09-11; every architectural claim verified against current official docs; comparative/community claims tagged LOW)

**Fixed decisions (not re-litigated here):** Next.js on Vercel (PWA) · Node/TypeScript API on GCP Cloud Run (all business logic; browser never talks to Supabase for data) · Supabase (Postgres, Auth, Storage, Realtime) · GitHub with deploy triggers to Vercel and GCP.

**Confidence legend used below:** `HIGH` = official docs + npm registry agree and nothing is in flux · `MEDIUM` = official docs fetched directly, but young/moving target or only partially verifiable · `LOW` = community sources only.

---

## Recommended Stack (one-screen summary)

| Layer | Choice | Version (npm, 2026-09-11) |
|---|---|---|
| Runtime | Node.js 24 LTS everywhere (Vercel, Cloud Run, CI) | 24.x |
| Language | TypeScript 7 (native Go compiler) | 7.0.2 |
| Web framework | Next.js App Router, Turbopack, `proxy.ts`, Cache Components on | 16.3.4 (React 19.3.0) |
| PWA | `@serwist/turbopack` + `serwist` (service worker), `app/manifest.ts` + per-tenant manifest route | 9.5.12 |
| Push | `web-push` (VAPID) in the API, subscriptions in Postgres | 3.6.7 |
| Styling | Tailwind CSS v4 + shadcn/ui, runtime brand tokens via `@theme inline` | 4.3.3 / shadcn 4.21.0 |
| API framework | Hono on `@hono/node-server`, `@hono/zod-openapi` (OpenAPI + RPC types) | 4.13.7 / 2.1.1 / 1.6.3 |
| Validation | Zod 4 (shared package) | 4.6.2 |
| Auth verification | `jose` against Supabase JWKS (ES256), tenant/role claims from Custom Access Token Hook | 6.2.12 |
| ORM / migrations | Drizzle ORM + drizzle-kit (schema + RLS policies in TS), applied by Supabase CLI | 0.45.2 / 0.31.10 / CLI 2.117.0 |
| DB driver | `postgres` (postgres.js) via Supavisor transaction pooler, `prepare: false` | 3.4.9 |
| Realtime | Supabase Realtime **Broadcast** (private channels, RLS on `realtime.messages`); client uses `@supabase/realtime-js` only | 2.116.0 |
| Background jobs | `pg-boss` (Postgres-backed queue) in a Cloud Run worker service | 12.31.0 |
| Media | Supabase Storage (signed upload URLs, TUS via `tus-js-client`, image transforms) + Mux for video | tus 4.3.1 / `@mux/mux-node` 15.1.0 |
| Link previews | `open-graph-scraper` in the API + oEmbed for YouTube/Vimeo | 6.12.0 |
| Data fetching (web) | TanStack Query + Hono RPC client (`hono/client`) | 5.102.8 |
| Forms | react-hook-form + `@hookform/resolvers` (Zod) | 7.87.0 / 5.9.1 |
| i18n strings | next-intl (single `pt-BR` catalog) | 4.14.4 |
| Monorepo | pnpm workspaces + Turborepo | 12.4.1 / 2.10.12 |
| Lint/format | Biome (replaces ESLint + Prettier; no TS JS-API dependency) | 2.5.13 |
| Tests | Vitest 5, Testing Library, MSW, Playwright, pgTAP (via `supabase test db`) | 5.0.0 / 16.3.3 / 2.15.0 / 1.63.0 |
| Observability | pino (JSON → Cloud Logging), Sentry (both apps) | 10.3.1 / `@sentry/*` 10.74.0 |
| CI/CD | GitHub Actions (WIF → Artifact Registry → `deploy-cloudrun@v3`), Vercel Git integration with `turbo-ignore` | — |

---

## Recommended Stack (detail)

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **Node.js** | 24 LTS | Runtime for web (Vercel), API and worker (Cloud Run), CI | Lowest common denominator that satisfies every dependency: Next 16 needs ≥20.9, `@supabase/supabase-js` 2.116 needs ≥22, Vitest 5 needs ^22.12 or ^24. Pin `engines.node: ">=24"` and `.nvmrc`/`.node-version` = 24. Docker base `node:24-slim`. | HIGH |
| **TypeScript** | 7.0.2 | Type checking (10x faster native compiler) | Next.js 16.3 (2026-08-03) officially supports `typescript@^7` for `next build` type checking. The 7.0 npm package no longer ships the JS compiler API, so anything that calls the TS API programmatically (typescript-eslint, some IDE plugins) lags until TS 7.1. This stack avoids that by using Biome for linting. **Fallback if a tool breaks:** alias `"typescript": "npm:@typescript/typescript6@^6.0.2"` and `"@typescript/native": "npm:typescript@^7"` (pattern recommended in Next.js discussion #95633). | MEDIUM |
| **Next.js** | 16.3.4 | Web app (PWA shell, BFF for auth cookies, SSR/RSC) | Fixed choice. Relevant 16.x facts: Turbopack is default (dev + build); `middleware.ts` is deprecated in favour of `proxy.ts` (Node runtime); `params`/`cookies()`/`headers()` are async; `next lint` removed; `revalidateTag(tag, profile)` + `updateTag()`; `cacheComponents: true` + `partialPrefetching: true` give SPA-like navigations (Instant Navigations, 16.3); experimental `useOffline` hook + `experimental.useOffline` for connectivity-aware retries (useful for a mobile PWA). Enable `reactCompiler: true`. | HIGH |
| **React** | 19.3.0 | UI | Ships with Next 16.3; View Transitions, `useEffectEvent`, `<Activity>`. | HIGH |
| **Hono** | 4.13.7 | API framework on Cloud Run (`@hono/node-server` 2.1.1) | Web-standard `Request`/`Response`, tiny cold start (matters on Cloud Run scale-to-zero), first-class Zod 4 validation, **built-in RPC client (`hono/client` `hc<AppType>`)** that gives the Next.js app end-to-end types with no codegen, and `@hono/zod-openapi` 1.6.3 (peer: `zod ^4`, `hono >=4.10`) to emit OpenAPI from the same schemas. Route groups map 1:1 to the "feature module" architecture (`feed`, `stories`, `communities`, `events`, `chat`, `notifications`), each a self-contained `new Hono()` mounted with `app.route('/feed', feed)`. See "Alternatives" for Fastify/NestJS. | MEDIUM |
| **Zod** | 4.6.2 | Runtime validation + shared contracts | Single schema language across API validators, OpenAPI, forms (`@hookform/resolvers`), and DB inserts (`drizzle-zod` 0.8.3 supports zod ^4). | HIGH |
| **Drizzle ORM / drizzle-kit** | 0.45.2 / 0.31.10 | Schema, queries, RLS policies, migration generation | SQL-shaped (no hidden query planner), and the only mainstream TS ORM with first-class Supabase RLS helpers: `pgTable(...).withRLS()`, `pgPolicy()`, and `drizzle-orm/supabase` exports (`authenticatedRole`, `serviceRole`, `authUid`, `realtimeTopic`, `realtimeMessages.link()`). Policies live next to the tables they protect, so tenant isolation is code-reviewed with the schema. `drizzle-kit generate` emits reviewable SQL. | MEDIUM |
| **postgres (postgres.js)** | 3.4.9 | DB driver | Drizzle's documented driver for Supabase. Connect through the Supavisor **transaction pooler** (port 6543) with `{ prepare: false }` (prepared statements unsupported in transaction mode). The pooler is IPv4, which sidesteps Supabase direct-connection IPv6 requirements from Cloud Run. Autoscaling Cloud Run instances × pooled connections stays bounded. | MEDIUM |
| **Supabase CLI** | 2.117.0 | Local stack (`supabase start`), applying migrations (`supabase db push`), `config.toml` (auth settings, hooks, buckets), pgTAP tests | Fixed platform; the CLI is the deploy/config tool of record. | HIGH |
| **Tailwind CSS** | 4.3.3 | Styling | CSS-first config; theme tokens compile to CSS variables. `@theme inline` is the documented mechanism for tokens that reference runtime-changing variables, which is exactly what per-tenant branding needs (see "Stack Patterns → White-label theming"). | HIGH |
| **shadcn/ui** | CLI 4.21.0 | Component primitives (Radix) | Copy-in components, Tailwind v4 native, uses `--color-primary`/`--color-background` tokens that we bind to tenant variables. | MEDIUM |
| **pnpm + Turborepo** | 12.4.1 / 2.10.12 | Monorepo, task graph, remote cache | pnpm 12 (2026-08-26) is the Rust rewrite; seamless from 11. Turborepo is what Vercel's Git integration understands natively (`turbo build` auto-scoped to Root Directory, `turbo-ignore`). | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| `@serwist/turbopack` + `serwist` + `esbuild` | 9.5.12 / 9.5.12 / 0.28.2 | Service worker with precache + runtime caching, offline fallback | Always (installability + push need a SW). Use the **Turbopack** integration, not `@serwist/next`, because Next 16 builds with Turbopack by default; `withSerwist` from `@serwist/turbopack` builds `app/sw.ts` through a generated route handler (`app/serwist/[path]/route.ts` via `createSerwistRoute`). | MEDIUM |
| `web-push` | 3.6.7 | Send Web Push (VAPID) | In the API/worker only. Store `PushSubscription` JSON per user+device in Postgres; drop subscriptions on 404/410. | HIGH |
| `jose` | 6.2.12 | Verify Supabase access tokens via `createRemoteJWKSet` | API auth middleware. JWKS URL `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` (edge-cached 10 min). Check `iss`, `exp`; read `sub`, `role`, and custom `tenant_id`/`app_role` claims. | HIGH |
| `@supabase/supabase-js` | 2.116.0 | Server-side use in the API only: Auth flows (`signInWithPassword`, `signUp`, `resetPasswordForEmail`, `admin.*` with service role), Storage signed URLs, Realtime REST | Never in the browser for data. | HIGH |
| `@supabase/realtime-js` | 2.116.0 | Browser subscribe-only client for Broadcast private channels | The single deliberate exception to "frontend never talks to Supabase" (read-only, see Realtime pattern). | MEDIUM |
| `tus-js-client` | 4.3.1 | Resumable uploads to Supabase Storage from the browser | Files > 6 MB (video, PDFs). Uses the signed upload token in `x-signature`, so no Supabase JWT is needed in the browser. `< 6 MB` → plain `PUT` to the signed upload URL. | MEDIUM |
| `sharp` | 0.35.4 | Server-side image processing in the API | Only for tenant branding assets: derive favicon `.ico`, 192/512 PNG icons, apple-touch-icon from the uploaded logo at provisioning time. Feed images use Supabase transforms instead. | HIGH |
| `@mux/mux-node` / `@mux/mux-player-react` | 15.1.0 / 3.13.3 | Video ingest (direct upload), transcoding to HLS, playback | Post/story video. See Media pipeline. | MEDIUM |
| `open-graph-scraper` | 6.12.0 | Link preview metadata (OG/Twitter tags) | In the API/worker with an SSRF allow-list (block private IPs, follow ≤3 redirects, 5 s timeout). YouTube/Vimeo go through their oEmbed endpoints instead. | LOW |
| `pg-boss` | 12.31.0 | Job queue on Postgres (push fan-out, link unfurl, Mux webhooks retry, notification digests) | Avoids adding Redis/Memorystore. Run workers in a separate Cloud Run service with instance-based billing (min-instances 1, `--no-cpu-throttling`), not in the request-serving API. | MEDIUM |
| `@tanstack/react-query` | 5.102.8 | Client cache for feed/chat/notification data, optimistic likes, infinite scroll | Pair with the Hono RPC client as the fetcher. | HIGH |
| `zustand` | 5.0.15 | Small client-only state (composer drafts, active chat, install-prompt state) | Only when React Query + URL state are not enough. | HIGH |
| `nuqs` | 2.10.1 | Type-safe URL search params (feed filters, community tabs) | Optional. | LOW |
| `react-hook-form` + `@hookform/resolvers` | 7.87.0 / 5.9.1 | Forms with Zod schemas shared with the API | Admin composer, profile, events, branding. | HIGH |
| `next-intl` | 4.14.4 | Centralised UI strings (pt-BR only in V1) | Requirement "all UI strings centralised for future i18n". Single locale, no routing prefix. | MEDIUM |
| `@t3-oss/env-nextjs` / `@t3-oss/env-core` | 0.13.11 | Fail-fast typed env vars (web / api) | Always. | HIGH |
| `pino` + `pino-http` | 10.3.1 / 11.0.0 | Structured JSON logs | Map `level` → `severity` so Cloud Logging parses them; include `tenant_id`, `user_id`, `request_id`. | HIGH |
| `@sentry/nextjs`, `@sentry/node` | 10.74.0 | Error tracking | Optional but cheap; add from phase 1. | MEDIUM |
| `lucide-react`, `class-variance-authority`, `tailwind-merge` | 1.45.0 / 0.7.1 / 3.6.0 | shadcn dependencies | Installed by shadcn CLI. | HIGH |
| `date-fns` | 4.4.0 | Dates (pt-BR locale, relative times, 24 h story window) | Always. | HIGH |
| `@scalar/hono-api-reference` | 0.12.1 | Serve API docs from the OpenAPI document | Dev/staging only. | LOW |

### Development Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| **Biome** | 2.5.13 | Lint + format for the whole monorepo | Next 16 removed `next lint` and recommends Biome or ESLint directly. Biome does not depend on the TypeScript JS API, so it is TS-7-safe. Add `@next/eslint-plugin-next` only if you later want Next-specific rules (requires ESLint 10 flat config). |
| **Vitest** | 5.0.0 | Unit/integration tests (web + api + db) | Node ^22.12 / ^24, Vite ^6.4–8. `vi.mock` must be top-level. Coverage via `@vitest/coverage-v8` 5.0.0. Use `happy-dom` 20.14 (fast) or `jsdom` 30 for component tests. |
| **Testing Library** | `@testing-library/react` 16.3.3, `jest-dom` 7.0.1 | Component tests | With `@vitejs/plugin-react` 6.1.1. |
| **MSW** | 2.15.0 | Mock the API in web tests | Also usable in Playwright for deterministic e2e. |
| **Playwright** | 1.63.0 | E2E on mobile viewports (iPhone/Pixel devices), PWA install flow, push permission | Next 16.3 adds `@next/playwright` `instant()` to assert instant navigations. |
| **pgTAP via `supabase test db`** | CLI 2.117.0 | RLS/tenant-isolation tests executed inside Postgres | Non-negotiable for "zero leakage between tenants": every policy gets a cross-tenant negative test. |
| **Supabase local stack** | CLI 2.117.0 | `supabase start` gives Postgres+Auth+Storage+Realtime in Docker for dev and CI | Use `supabase/setup-cli@v1` in GitHub Actions. |
| **drizzle-kit** | 0.31.10 | `generate` migrations, `studio` | `migrations.prefix: "supabase"` produces Supabase-CLI-compatible timestamped filenames. |
| **turbo** | 2.10.12 | `turbo run lint typecheck test build`, `turbo prune --docker` for slim API images | Declare `env` per task in `turbo.json` so caches don't leak between environments. |
| **@next/codemod** | 16.3.4 | Upgrades | `npx @next/codemod@canary upgrade latest`. |
| **knip** | 6.35.1 | Dead code/deps | Optional hygiene. |

---

## Installation

```bash
# ── Monorepo root ─────────────────────────────────────────────
corepack enable && corepack prepare pnpm@12.4.1 --activate
pnpm init
pnpm add -D -w turbo@2.10.12 typescript@7.0.2 @biomejs/biome@2.5.13 vitest@5.0.0 @vitest/coverage-v8@5.0.0

# pnpm-workspace.yaml → packages: ["apps/*", "packages/*"]

# ── apps/web (Next.js PWA) ────────────────────────────────────
pnpm create next-app@latest apps/web --ts --tailwind --app --src-dir --turbopack --use-pnpm
cd apps/web
pnpm add next@16.3.4 react@19.3.0 react-dom@19.3.0
pnpm add @tanstack/react-query@5.102.8 zustand@5.0.15 react-hook-form@7.87.0 @hookform/resolvers@5.9.1 zod@4.6.2 \
        next-intl@4.14.4 @t3-oss/env-nextjs@0.13.11 @supabase/realtime-js@2.116.0 tus-js-client@4.3.1 \
        @mux/mux-player-react@3.13.3 date-fns@4.4.0 nuqs@2.10.1 lucide-react class-variance-authority tailwind-merge \
        @sentry/nextjs@10.74.0
pnpm add -D @serwist/turbopack@9.5.12 serwist@9.5.12 esbuild@0.28.2 tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 \
        babel-plugin-react-compiler@1.0.0 @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 happy-dom@20.14.3 \
        @vitejs/plugin-react@6.1.1 msw@2.15.0 @playwright/test@1.63.0
pnpm dlx shadcn@4.21.0 init

# ── apps/api (Hono on Cloud Run) ──────────────────────────────
pnpm add hono@4.13.7 @hono/node-server@2.1.1 @hono/zod-openapi@1.6.3 zod@4.6.2 jose@6.2.12 \
        @supabase/supabase-js@2.116.0 drizzle-orm@0.45.2 postgres@3.4.9 drizzle-zod@0.8.3 \
        web-push@3.6.7 pg-boss@12.31.0 sharp@0.35.4 open-graph-scraper@6.12.0 @mux/mux-node@15.1.0 \
        pino@10.3.1 pino-http@11.0.0 @t3-oss/env-core@0.13.11 @sentry/node@10.74.0
pnpm add -D drizzle-kit@0.31.10 tsx@4.23.13 tsup@8.5.1 @scalar/hono-api-reference@0.12.1 @types/node

# ── packages/db (Drizzle schema + RLS policies), packages/contracts (Zod + AppType) ──
pnpm add drizzle-orm@0.45.2 zod@4.6.2 && pnpm add -D drizzle-kit@0.31.10

# ── Supabase CLI (dev machine + CI) ───────────────────────────
brew install supabase/tap/supabase   # 2.117.0; CI: supabase/setup-cli@v1
supabase init && supabase start
```

---

## Stack Patterns by Variant (how to do the fixed choices well)

### 1. PWA: service worker, installability, Web Push (Next 16 + Turbopack)

- **Service worker:** `@serwist/turbopack` (`withSerwist(nextConfig)`), `app/sw.ts` with `defaultCache` runtime strategies, navigation preload, and an `/~offline` fallback page. Precache only the app shell; feed/media are network-first with short cache. Register the SW from a client component (`navigator.serviceWorker.register('/serwist/sw.js', { updateViaCache: 'none' })` as in the official guide) and serve it with `Cache-Control: no-store` via `headers()` in `next.config.ts`.
- **Manifest:** keep a neutral `app/manifest.ts` (TRIA default) for the unauthenticated shell, and a **per-tenant manifest route** `app/m/[tenantSlug]/manifest.webmanifest/route.ts` that returns `name`, `short_name`, `theme_color`, `background_color`, `icons` from the tenant record. In the authenticated root layout, `generateMetadata` returns `manifest: '/m/<slug>/manifest.webmanifest'` and `icons: {...tenant icon URLs}`. `start_url: '/'` and `scope: '/'` stay identical (single origin; a user belongs to one tenant). Set `id: '/?tenant=<slug>'` so the OS treats tenants as distinct apps if a device ever installs two. Because Next caches `manifest.ts`/`icon.tsx` route handlers by default, put tenant data behind a route handler with `export const dynamic = 'force-dynamic'` (or `revalidateTag('tenant-<id>')` on branding change) rather than reading cookies inside `manifest.ts`.
- **Icons:** generate `favicon.ico`, `icon-192.png`, `icon-512.png` (maskable), `apple-icon-180.png` from the tenant logo with `sharp` when `super_admin`/`admin_tenant` uploads branding; store in a public `branding` bucket; reference them from the manifest and `generateMetadata().icons`. Do not rely on `app/icon.tsx` for tenant icons (favicon cannot be generated and the convention is static-by-default).
- **Installability:** valid manifest + HTTPS is enough; do **not** build on `beforeinstallprompt` (not on iOS). Ship the official-guide `InstallPrompt` pattern: detect `display-mode: standalone` and show an iOS "Share → Add to Home Screen" coach mark.
- **Web Push:** `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` only after a user gesture (iOS requires it); POST the subscription to the API (`/notifications/push-subscriptions`); API sends with `web-push` from the worker. iOS 16.4+ supports push only for Home-Screen-installed PWAs, so the notification-permission UI must be gated behind "installed" on iOS. Keep VAPID keys in Secret Manager / Vercel env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` on web, private key only in API).
- **Offline/network resilience:** enable `experimental.useOffline` and show an offline banner with `useOffline()`; combine with `cacheComponents` + `partialPrefetching` so prefetched shells render offline.

### 2. API on Cloud Run: Hono, modules, auth, tenant scoping

- **Layout:** `apps/api/src/modules/<feature>/{routes.ts,service.ts,schema.ts,policies.ts}`; `app.route('/v1/feed', feedRoutes)` etc. Export `type AppType = typeof app` from `packages/contracts` for the web client (`hc<AppType>(API_URL)`); keep `strict: true` in every tsconfig; pre-build types (`tsc -b` / project references) so IDE inference stays fast with many routes.
- **Auth verification (per request):** `jose.jwtVerify(token, createRemoteJWKSet(JWKS_URL), { issuer: 'https://<ref>.supabase.co/auth/v1' })`. Project must use **asymmetric signing keys (ES256)**; the legacy HS256 shared secret is explicitly "not recommended for production" and blocks zero-downtime rotation.
- **Tenant + role claims:** a `custom_access_token_hook(event jsonb)` (plpgsql, `grant execute ... to supabase_auth_admin`) adds `tenant_id` and `app_role` (`super_admin | admin_tenant | support_tenant | member`) from `public.memberships` into the JWT. Never drop the required claims (`iss aud exp iat sub role aal session_id email phone is_anonymous`). Because claims are minted at sign-in, block/role changes take effect on refresh (access token TTL ≤ 1 h) — for immediate blocking also check a `blocked_at` column in the auth middleware.
- **Auth endpoints live in the API** (`/auth/signup?tenant=<slug>`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot`, `/auth/reset`): the API calls Supabase Auth server-side with the publishable key, returns the session. The Next.js app acts as a thin **BFF**: a route handler/`proxy.ts` stores `access_token`/`refresh_token` in `HttpOnly; Secure; SameSite=Lax` cookies and forwards `Authorization: Bearer` to Cloud Run. This keeps tokens out of `localStorage` (XSS) while still allowing the browser to hand the access token to Realtime (see 5) and TUS uploads use signed tokens, not the JWT.
- **Tenant scoping (defense in depth, three layers):**
  1. Middleware sets `c.set('auth', { userId, tenantId, role })` from verified claims; every service call receives it explicitly (never from the request body).
  2. Every tenant table has `tenant_id uuid not null` + composite indexes `(tenant_id, created_at desc)`; repository helpers always add `eq(table.tenantId, ctx.tenantId)`.
  3. **RLS is enforced even though the API is the only client:** the API connects as a dedicated non-superuser role (see 3) and wraps each request in `db.transaction(async tx => { await tx.execute(sql\`select set_config('request.jwt.claims', ${claimsJson}, true); set local role authenticated;\`); ... })`. Policies use `(auth.jwt()->>'tenant_id')::uuid = tenant_id`. A forgotten `where` then returns zero rows instead of another tenant's data.
- **`super_admin`** platform-panel routes use a separate `set local role service_role` branch (or a `tria_admin` role with `bypassrls`) behind an explicit `requireSuperAdmin()` guard and audit log.
- **Cloud Run settings:** HTTP/1 request/response bodies cap at 32 MiB, so **uploads never pass through the API** (signed direct-to-Storage instead). Concurrency 80–200, CPU always-allocated only for the worker service, min-instances 1 for the API in production to avoid cold-start latency on chat.

### 3. ORM, migrations, RLS ownership

- **Schema source of truth:** Drizzle TS in `packages/db/schema/<module>.ts`, including `.withRLS()` and `pgPolicy(...)` per table, and `realtimeMessages.link(...)` / `storage.objects` policies from `drizzle-orm/supabase`.
- **Migrations:** `drizzle-kit generate` with `out: './supabase/migrations'` and `migrations: { prefix: 'supabase' }` so files are `YYYYMMDDHHmmss_name.sql`; review the SQL in PR; apply with `supabase db push` in CI (prod) and `supabase db reset` locally. One migration folder, one tool applying, Supabase CLI keeping the history table. Do not also run `drizzle-kit migrate` (two history tables = drift). Hand-written SQL (the auth hook function, triggers for `realtime.broadcast_changes`, `pg-boss` schema grants) goes in `--custom` migrations.
- **Runtime DB role:** create `api_user` (`LOGIN`, `NOBYPASSRLS`) with `GRANT authenticated, service_role TO api_user` and grants on `public` tables; the API's `DATABASE_URL` uses this role through the pooler. Migrations use the `postgres` connection string only in CI. Rationale: Supabase's `postgres` role can bypass RLS, which would silently neutralise layer 3 above.
- **Seed/local:** `supabase start` + `supabase db reset` + a `seed.ts` using Drizzle for a demo tenant, admin, members.
- **Story expiry** is a predicate (`published_at > now() - interval '24 hours'` or `expires_at`), not a job. **Soft delete** columns (`deleted_at`) on comments/members for moderation.

### 4. Media pipeline

- **Buckets:** `media` (private; posts/stories/attachments), `avatars` (public), `branding` (public). Object keys are `<tenant_id>/<entity>/<uuid>.<ext>`; `storage.objects` policies check the tenant prefix.
- **Upload flow:** client asks API `POST /media/uploads` (validates mime/size/quota, records a pending `media` row) → API returns `createSignedUploadUrl` token → browser uploads directly (`PUT` ≤ 6 MB, TUS via `tus-js-client` above 6 MB with the fixed 6 MB chunk, `x-signature` header) → client `POST /media/uploads/:id/complete` → API verifies object exists, stores dimensions/mime, enqueues thumbnail/unfurl jobs.
- **Images:** serve through Supabase **image transformations** (`/storage/v1/render/image/...`, or transform params on signed URLs for the private bucket) with a custom Next `images.loader`; widths 1–2500, `quality` 75–80, auto-WebP. Requires **Supabase Pro plan** (100 origin images included, then USD 5 per 1,000). Pro is required anyway: Free caps files at 50 MB and Realtime at 200 connections.
- **Video:** Supabase Storage has **no transcoding**. Mobile uploads (iPhone HEVC/MOV) would not play on Android/Chrome. Use **Mux direct uploads** (API creates an upload URL, browser uploads, Mux webhook → `video.asset.ready` → store `playback_id`), play with `<MuxPlayer>` (HLS, adaptive bitrate, poster/thumbnails). Cheaper alternative with the same architecture: Cloudflare Stream (USD 5/1,000 min stored, USD 1/1,000 min delivered). Only if budget forbids both: accept H.264 MP4 only in Storage and play with `<video playsinline>` (range requests are supported), knowing HEVC uploads must be rejected at the API.
- **Embeds/links:** API `POST /links/preview` → worker fetches OG metadata with `open-graph-scraper` (SSRF guard), caches in `link_previews` keyed by URL hash per tenant; YouTube/Vimeo via oEmbed (`https://www.youtube.com/oembed?url=...`, `https://vimeo.com/api/oembed.json?url=...`) render as sandboxed iframes (`lite-youtube-embed` optional for performance).
- **Attachments (PDF etc.):** private bucket, signed download URLs (short TTL) from the API; render with the browser's native viewer (`<a download>` / `target=_blank`).

### 5. Realtime: chat and notifications

- **Use Supabase Realtime Broadcast, not WebSockets on Cloud Run.** Cloud Run WebSockets are 60-minute-max requests with best-effort affinity and no shared state, so a chat server there needs Redis/Memorystore for fan-out and keeps instances billed while any socket is open. Realtime already solves fan-out, auth, reconnection and replay (72 h on private channels).
- **Topics:** `tenant:<tenant_id>:conv:<conversation_id>` (chat) and `tenant:<tenant_id>:user:<user_id>` (notification bell). Always `private: true` and disable "Allow public access" in Realtime settings.
- **Authorization:** RLS on `realtime.messages` using `realtime.topic()`: a `select` policy joining `conversation_participants` (chat) or matching the user id (notifications), scoped by the JWT `tenant_id`. Defined in Drizzle via `realtimeMessages.link(...)`. Keep policies cheap (indexed lookups) — Supabase warns complex RLS raises join latency.
- **Publishing:** the write path is the API → Postgres. Prefer **Broadcast from Database**: `after insert` triggers on `messages` and `notifications` call `realtime.broadcast_changes(topic, ...)`, so every write (API, worker, migrations) publishes automatically and the API stays stateless. For ad-hoc events (typing indicators), the API calls the Realtime REST endpoint `POST /realtime/v1/api/broadcast` with the service key (do not use `channel.send()` from supabase-js server-side without subscribing — known empty-Authorization bug).
- **Client:** `@supabase/realtime-js` `RealtimeClient(REALTIME_URL, { params: { apikey: PUBLISHABLE_KEY } })`, `setAuth(accessToken)` from the BFF, subscribe, and re-`setAuth` on refresh (clients are disconnected when the JWT expires). This is a **read-only** connection; all state changes still go through the API. Record this exception in PROJECT.md's decisions.
- **Capacity:** Pro = 500 concurrent connections / 500 msg/s; Pro without spend cap or Team = 10,000 / 2,500. A pilot tenant is far below; plan the Team tier before ~400 simultaneous online members.
- **In-app notification center:** notifications table + unread counter (`select count(*) where read_at is null`) served by the API; the Broadcast event only invalidates the React Query cache (`queryClient.invalidateQueries(['notifications'])`) and bumps the badge.

### 6. White-label runtime theming (Tailwind v4)

- In `globals.css`:
  ```css
  @import "tailwindcss";
  @theme inline {
    --color-primary: var(--brand-primary);
    --color-primary-foreground: var(--brand-primary-fg);
    --color-secondary: var(--brand-secondary);
    --color-accent: var(--brand-accent);
    --color-background: var(--brand-bg);
    --color-foreground: var(--brand-fg);
  }
  :root { --brand-primary: oklch(0.55 0.2 260); /* TRIA defaults */ }
  ```
  `@theme inline` makes `bg-primary` compile to the *value* `var(--brand-primary)` so overriding `--brand-*` at runtime just works.
- After login, the authenticated layout (server component) reads the tenant and renders `<html style={{ '--brand-primary': tenant.colors.primary, ... }}>` (or a `<style>` block) plus `<meta name="theme-color">`. No client flash: it is server-rendered on first HTML. Store colors as OKLCH or hex + derived foreground (compute contrast server-side with a tiny WCAG helper and persist both).
- shadcn components consume `--color-primary` etc. natively, so no component changes per tenant. Logo and display name come from the same tenant record; favicon/manifest per pattern 1.
- Cache the tenant branding query with `"use cache"` + `cacheTag('tenant-<id>')` and `updateTag` in the branding server action for read-your-writes.

### 7. Shared types and monorepo layout

```
apps/web         Next.js 16 (Vercel)          apps/api      Hono (Cloud Run "api")
apps/worker      pg-boss workers (Cloud Run "worker", same Docker image, different CMD)
packages/db      Drizzle schema + policies + drizzle.config.ts   (out: ../../supabase/migrations)
packages/contracts  Zod schemas, DTOs, `AppType` export, event names/topics
packages/config  tsconfig base, biome.json
supabase/        config.toml, migrations/, tests/ (pgTAP), seed
```
- `packages/contracts` is imported by both apps; `apps/web` never imports `packages/db` (keeps DB code out of the client bundle and the Vercel build).
- Turborepo tasks: `build`, `typecheck`, `lint`, `test`, `db:generate`; `turbo.json` `env` lists `NEXT_PUBLIC_*`, `API_URL`, etc. per task.
- Docker: `turbo prune api --docker` → multi-stage `node:24-slim` image → `pnpm install --frozen-lockfile --prod`, `tsup` bundle to `dist/`.

### 8. CI/CD from GitHub

- **Web → Vercel:** Git integration, Root Directory `apps/web`, Build Command `turbo build` (auto-scoped), Ignored Build Step `npx turbo-ignore --fallback=HEAD^1`, preview per PR, production on `main`. Enable Vercel Remote Cache. Env vars via `vercel env`.
- **API/worker → Cloud Run:** `.github/workflows/deploy-api.yml` on push to `main` with `paths: [apps/api/**, apps/worker/**, packages/**, supabase/migrations/**]`:
  1. `google-github-actions/auth@v3` with **Workload Identity Federation** (no JSON keys);
  2. build + push image to Artifact Registry (`docker/build-push-action`);
  3. `supabase/setup-cli@v1` → `supabase db push --db-url $SUPABASE_DB_URL` (migrations before the new code goes live; keep migrations backward compatible);
  4. `google-github-actions/deploy-cloudrun@v3` for `api` and `worker` (service account needs Cloud Run Admin + Service Account User). Use `--tag` revisions + traffic split for canary if wanted.
- **PR checks:** `ci.yml` runs `turbo lint typecheck test` and, in a job with `supabase start`, the API integration tests + `supabase test db` (pgTAP RLS tests). Playwright e2e against a Vercel preview URL (Vercel deployment protection bypass token) on `main`.
- Secrets: Supabase service key, DB URLs, VAPID private key, Mux tokens in **GCP Secret Manager** mounted as Cloud Run env; only publishable keys in Vercel.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hono 4 | **Fastify 5.12.4** | If the team prefers Node-native plugin ecosystem (multipart, rate-limit, swagger) and JSON-Schema/TypeBox over Zod; fastest raw Node throughput. Loses the zero-codegen RPC client and Web-standard handlers. Fine choice, second place. |
| Hono 4 | **NestJS 12.0.1** | Only for a large team that wants framework-enforced DI/decorators. Heavier cold start, more boilerplate per module, and its module system overlaps with our own "feature module" convention. Not recommended for a 1–3 dev pilot. |
| Drizzle | **Prisma 7.10 (8.0 RC)** | Prisma 7 is now Rust-free, ESM-only, `prisma.config.ts` required — a good ORM, but no RLS/policy DSL, a generated client, and migration history in its own table. Choose it only if the team already knows Prisma well and will manage RLS in raw SQL migrations. |
| drizzle-kit → Supabase CLI applies | `drizzle-kit migrate` as the applier | If you decide not to use the Supabase local stack/CLI at all. Never run both appliers. |
| Supabase Realtime Broadcast | **WebSockets/Socket.IO on Cloud Run** | Only if a hard rule forbids any browser↔Supabase connection; then add Memorystore Redis pub/sub, session affinity, min-instances, and reconnection logic. Or SSE from the API subscribed to Realtime server-side (adds a hop, keeps the rule). |
| Broadcast (DB trigger) | **Postgres Changes** | Never for this product: per-connection RLS evaluation on every change and no topic-level authorization; Supabase now steers new work to Broadcast. |
| Mux | **Cloudflare Stream** | Lower cost at scale, same architecture (direct upload + HLS player). Pick Stream if per-minute cost dominates and you don't need Mux Data/analytics. |
| `@serwist/turbopack` | **`@serwist/next` (webpack)** | Only if you run `next build --webpack`. |
| pg-boss | **Cloud Tasks / Pub/Sub** | If you want GCP-managed retries and no worker polling; more infra, more IAM, and jobs outside Postgres transactions. |
| Biome | **ESLint 10 + typescript-eslint** | If you need `@next/eslint-plugin-next` rules today; then keep `typescript` on the TS 6 alias until TS 7.1 restores the JS API. |
| BFF cookies (Next route handlers) | **Browser → API directly with Bearer** | Simpler, but tokens must live in memory/IndexedDB; acceptable only with a strict CSP and short access-token TTL. |
| next-intl | Plain typed message object | If the team finds next-intl heavy for one locale; the requirement is only "strings centralised". |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `next-pwa` (5.6.0, 2022) | Unmaintained, webpack-only, breaks under Turbopack/Next 16 | `@serwist/turbopack` 9.5 |
| `middleware.ts` | Deprecated in Next 16 (edge-only, will be removed) | `proxy.ts` (Node runtime) |
| `experimental.ppr` / `dynamicIO` flags, `images.domains`, `next lint`, sync `params`/`cookies()` | Removed/deprecated in Next 16 | `cacheComponents`, `images.remotePatterns`, Biome, `await params` |
| Supabase **legacy JWT secret (HS256)** verification | "Not recommended for production"; no zero-downtime rotation; forces sharing the secret with the API | ES256 signing keys + JWKS with `jose` |
| `service_role` key / `postgres` role for tenant queries | Bypasses RLS: one missing `where` leaks tenants | `api_user` role + `set local role authenticated` per transaction |
| `@supabase/supabase-js` in the browser for data/storage | Violates the fixed architecture and duplicates business rules | Hono RPC client → API; `@supabase/realtime-js` subscribe-only |
| Uploading files **through** Cloud Run | 32 MiB HTTP/1 body cap, doubled egress, blocks instances | Signed upload URLs + TUS direct to Storage; Mux direct upload for video |
| Storing raw HEVC/MOV video in Storage as the playback source | No transcoding; won't play on Android/Chrome | Mux (or Cloudflare Stream) |
| Supabase Realtime **Postgres Changes** for chat | Per-connection RLS checks, 1 MB payload cap, no topic auth | Broadcast on private channels (DB trigger `realtime.broadcast_changes`) |
| Socket.IO / `ws` server inside the request-serving API on Cloud Run | 60-min request cap, no shared state, always-billed instances | Supabase Realtime |
| `channel.send()` from supabase-js on the server without subscribing | Falls back to REST with empty Authorization → 500 (supabase-js #1936) | Direct `POST /realtime/v1/api/broadcast` with service key, or DB trigger |
| `localStorage` tokens in the PWA | XSS exposure on a long-lived installed app | HttpOnly cookies via Next BFF |
| Running `drizzle-kit migrate` **and** `supabase db push` | Two migration history tables → drift | drizzle-kit generate → Supabase CLI applies |
| `prepare: true` (default) on the transaction pooler | "prepared statement already exists" errors under load | `postgres(url, { prepare: false })` |
| `beforeinstallprompt`-only install UX | Not supported on iOS Safari | Manifest + HTTPS + iOS coach mark |
| typescript-eslint with `typescript@7.0` | TS 7.0 package has no JS compiler API until 7.1 | Biome, or TS 6 alias |
| Redis/Memorystore in V1 | Extra managed service, VPC connector, cost — nothing in V1 needs it | pg-boss on Postgres, Realtime for fan-out |
| Custom-domain-per-tenant logic in V1 | Out of scope; keep tenant resolution from the JWT claim | `tenant_id` claim; hostname resolution can be layered in `proxy.ts` later |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `next@16.3.4` | `react@19.3.0`, `react-dom@19.3.0`, Node ≥ 20.9, `typescript@^7` (or ≥5.1) | TS 7 type-check support landed in 16.3; peer `@playwright/test ^1.51`. |
| `typescript@7.0.2` | Biome 2.5, Vitest 5, tsup/esbuild, Next 16.3 | **Not** with tools needing `lib/typescript.js` (typescript-eslint) until TS 7.1 (`7.1.0-dev` nightlies exist). Fallback alias `@typescript/typescript6@6.0.2`. |
| `@serwist/turbopack@9.5.12` | `serwist@9.5.12`, `esbuild`, Next ≥ 15 | Turbopack path; `@serwist/next` remains webpack-only. |
| `@hono/zod-openapi@1.6.3` | `zod ^4.0.0`, `hono >=4.10.0` | Zod 3 not supported by 1.x. |
| `@hono/node-server@2.1.1` | `hono ^4`, Node ≥ 20 | Returns the `node:http` server (you manage `close()` for graceful Cloud Run shutdown on SIGTERM). |
| `drizzle-zod@0.8.3` | `zod ^3.25 \|\| ^4`, `drizzle-orm >=0.36` | OK with Zod 4.6. |
| `drizzle-orm@0.45.2` | `postgres@3.4.9`, `drizzle-kit@0.31.10` | RLS API (`withRLS`, `pgPolicy`, `drizzle-orm/supabase`). |
| `@supabase/supabase-js@2.116.0` | Node ≥ 22 | Same version line for `realtime-js`/`storage-js` 2.116.0. |
| `vitest@5.0.0` | Node ^22.12 \|\| ^24, `vite ^6.4 \|\| ^7 \|\| ^8` (8.3.0 current), `@vitest/coverage-v8@5.0.0` | Released 2026-09-03; config lookup no longer walks up directories — give each package its own `vitest.config.ts` or use workspace projects. |
| `tailwindcss@4.3.3` | `@tailwindcss/postcss@4.3.3`, shadcn CLI 4.21.0 | Tailwind v4 theme variables required for the theming pattern. |
| `pnpm@12.4.1` | Turborepo 2.10.12, Node 24 | pnpm 12 = Rust rewrite (2026-08-26), drop-in from 11; unknown keys in `pnpm-workspace.yaml` now error when the pnpm version is pinned. |
| `web-push@3.6.7` | Node 24 | Stable; VAPID via `web-push generate-vapid-keys`. |
| Supabase Realtime private channels | JWT with `tenant_id` claim | Client must call `setAuth()` again after token refresh or it is disconnected at `exp`. |
| Supabase image transforms / 500 GB files / 500 Realtime conns | **Pro plan** | Free plan: 50 MB files, no transforms, 200 connections — dev only. |

---

## Sources

Official documentation (fetched directly 2026-09-11; tier MEDIUM per the classify-confidence seam, cross-verified with npm registry metadata):

- https://nextjs.org/docs/app/guides/progressive-web-apps — manifest.ts, SW registration, web-push, iOS 16.4+ push, Serwist Turbopack/webpack examples, `useOffline` (doc version 16.3.4, updated 2026-07-30)
- https://nextjs.org/blog/next-16 — Turbopack default, `proxy.ts`, Cache Components, removals/deprecations, Node ≥ 20.9
- https://nextjs.org/blog/next-16-3 — TypeScript 7 type-checking support, Instant Navigations (`cacheComponents`, `partialPrefetching`), `useOffline`, `@next/playwright` `instant()` (2026-08-03)
- https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest and .../app-icons — route handlers cached by default unless request-time APIs; favicon cannot be generated
- https://serwist.pages.dev/docs/next/turbo — `@serwist/turbopack` `withSerwist`, `createSerwistRoute`, `app/sw.ts`
- https://serwist.pages.dev/docs/next/getting-started — `@serwist/next` is the webpack path
- https://supabase.com/docs/guides/auth/signing-keys — ES256 recommended, JWKS endpoint, legacy HS256 "not recommended for production", zero-downtime rotation
- https://supabase.com/docs/guides/auth/jwts — `createRemoteJWKSet` pattern, JWKS edge cache 10 min
- https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook — hook signature, grants, required claims
- https://orm.drizzle.team/docs/rls — `withRLS`, `pgPolicy`, `drizzle-orm/supabase` helpers, `set_config` + `set local role` transaction pattern
- https://orm.drizzle.team/docs/connect-supabase — postgres-js driver, `prepare: false` for transaction pooler, ports 5432/6543
- https://supabase.com/docs/guides/realtime/broadcast, .../authorization, .../limits — REST send, `broadcast_changes` trigger, private channels, `realtime.topic()`, per-plan quotas
- https://supabase.com/docs/guides/storage/serving/image-transformations, .../uploads/file-limits, .../uploads/resumable-uploads, .../uploads/standard-uploads — Pro-plan transforms and pricing, 50 MB vs 500 GB limits, 6 MB TUS threshold, signed upload tokens
- https://docs.cloud.google.com/run/docs/triggering/websockets and https://docs.cloud.google.com/run/quotas — 60 min timeout, best-effort affinity, 32 MiB HTTP/1 bodies, 1,000 concurrency, billing while sockets open
- https://tailwindcss.com/docs/theme — `@theme`, `@theme inline` for runtime variables
- https://hono.dev/docs/guides/rpc and https://hono.dev/docs/getting-started/nodejs — `hc<AppType>`, strict tsconfig, precompiled types; `@hono/node-server`
- https://github.com/google-github-actions/deploy-cloudrun — v3, `auth@v3` WIF, IAM roles
- https://vercel.com/docs/monorepos/turborepo — Root Directory, `turbo build`, `turbo-ignore`, `turbo.json` env hashing (updated 2026-08-28)
- https://pnpm.io/blog/releases/12.0 — Rust rewrite, breaking changes (2026-08-26)
- https://github.com/vercel/next.js/discussions/95633 — TS 7 detection problem, TS 6 alias workaround, PR #95639
- npm registry (`npm view`) on 2026-09-11 for every version and peer/engine range listed above (HIGH for version numbers)

Community / comparative sources (tier LOW; used only for opinions already consistent with official docs):

- https://encore.dev/articles/nestjs-vs-fastify-vs-hono, https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/ — framework positioning
- https://www.prisma.io/blog/announcing-prisma-orm-7-0-0, https://www.infoq.com/news/2026/01/prisma-7-performance/ — Prisma 7 changes
- https://github.com/rphlmr/drizzle-supabase-rls, https://theroadtoenterprise.com/blog/postgres-rls-multi-tenant-saas — backend-only RLS transaction pattern
- https://github.com/supabase/supabase-js/issues/1936 — server-side `channel.send()` REST fallback bug
- https://github.com/orgs/supabase/discussions/2178, https://supabase.com/partners/mux — no built-in transcoding; Mux partnership
- https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications — iOS install + user-gesture requirements, Declarative Web Push (Safari 18.4)
- https://www.infoq.com/news/2026/08/typescript-7-released/, https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ — TS 7 GA 2026-07-08, missing JS API until 7.1
- https://zenn.dev/azuma317/articles/drizzle-migration-supabase-production — drizzle-kit `out: ./supabase/migrations` workflow

---
*Stack research for: multi-tenant white-label community PWA (Next.js on Vercel + Hono on Cloud Run + Supabase)*
*Researched: 2026-09-11*
