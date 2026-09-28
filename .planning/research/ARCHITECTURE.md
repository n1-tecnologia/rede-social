# Architecture Research

**Domain:** Multi-tenant, white-label community / social-network SaaS (single URL, tenant resolved from the user's account)
**Researched:** 2026-09-11
**Confidence:** MEDIUM overall (see "Confidence notes" at the end: official-docs findings are strong; ecosystem-pattern findings are consensus, not measured)

Fixed constraints this document designs around (from PROJECT.md):

- Next.js on Vercel; one URL for every tenant; tenant comes from the logged-in user, never from the hostname.
- Node/TypeScript API on GCP Cloud Run holds all business logic; the frontend does not read/write Supabase data directly.
- Supabase for Postgres, Auth, Storage, Realtime.
- GitHub as source of truth with automated deploys to Vercel and Cloud Run.
- Modular: each feature (feed, communities, stories, events, chat, notifications, moderation, profiles) is a self-contained module (schema + API + UI), toggled per tenant, reusable in other Rede Social products.
- Roles: `super_admin` (Rede Social, cross-tenant), `admin_tenant`, `support_tenant`, `member`.
- Schema born ready for V2: members posting, members creating communities, member-to-member chat, users in multiple tenants.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CLIENT (mobile browser / installed PWA / desktop)                            │
│  Next.js App Router UI · service worker (push + offline shell)                │
│  Supabase Realtime client (subscribe-only, private channels, ids-only events) │
└───────────┬───────────────────────────────────────────┬──────────────────────┘
            │ HTTPS (cookies)                            │ WSS (Realtime)
┌───────────▼───────────────────────────┐   ┌───────────▼──────────────────────┐
│  NEXT.JS on VERCEL  (BFF + rendering) │   │  SUPABASE REALTIME               │
│  · auth session (cookies, @supabase/  │   │  · private topics gated by RLS   │
│    ssr; login/refresh/recovery only)  │   │    on realtime.messages          │
│  · calls API with user JWT            │   │  · fed by Postgres triggers      │
│  · loads /me/bootstrap → theme, nav   │   │    (realtime.send) or the API    │
│  · manifest / favicon per tenant      │   └───────────▲──────────────────────┘
│  · NEVER touches Postgres/Storage     │               │
└───────────┬───────────────────────────┘               │
            │ HTTPS  Authorization: Bearer <supabase jwt>│
┌───────────▼───────────────────────────────────────────┼──────────────────────┐
│  API on CLOUD RUN  (modular monolith, Node/TS)        │                      │
│  ┌───────────────── core (platform kernel) ─────────┐ │                      │
│  │ auth verify (JWKS) · tenant context · RBAC ·      │ │                      │
│  │ module registry + feature flags · db lanes        │ │                      │
│  │ (tenantDb = RLS, adminDb = service role) · jobs   │ │                      │
│  └───────────────────────────────────────────────────┘ │                      │
│  ┌────────┐┌───────────┐┌────────┐┌────────┐┌──────┐┌────────────┐┌────────┐│
│  │profiles││communities││ feed   ││stories ││events││notifications││ chat   ││
│  └────────┘└───────────┘└────────┘└────────┘└──────┘└────────────┘└────────┘│
│  ┌────────┐┌───────────┐┌────────────────────┐                               │
│  │ media  ││moderation ││ platform (super_admin panel API)                    │
│  └────────┘└───────────┘└────────────────────┘                               │
│  worker process (same image, `--role worker`): fan-out, push send, cleanup    │
└───────────┬───────────────────────────────┬───────────────────────────────────┘
            │ Postgres (pooler)              │ Storage REST (signed upload/serve URLs)
┌───────────▼───────────────────────────────▼───────────────────────────────────┐
│  SUPABASE                                                                      │
│  Postgres (shared schema, tenant_id on every row, RLS) · Auth (GoTrue) ·        │
│  Storage (private buckets, TUS resumable, image transforms) · Realtime          │
└────────────────────────────────────────────────────────────────────────────────┘
            ▲
            │ direct browser → Storage upload via signed URL (bytes never cross Cloud Run)
```

Two deliberate exceptions to "the frontend never talks to Supabase":

1. **Auth session mechanics** (login, refresh, password recovery) run in the Next.js server via `@supabase/ssr`, because Supabase Auth is an identity provider, not the database. Account *provisioning* (sign-up that binds a user to a tenant, admin creation) still goes through the API.
2. **Realtime subscribe** and **Storage upload/download via signed URLs** are transports, not data authority. Realtime events carry only ids ("post 123 changed"); the client always refetches through the API. Uploads go to Storage directly because streaming video through Cloud Run is the wrong shape (cost, timeouts, 32 MB HTTP/1 request cap risk).

If the team prefers strict purity, both can be moved behind the API later (auth proxy endpoints; SSE from Cloud Run); the design below isolates them so that swap is local.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Next.js app (Vercel) | Rendering, PWA shell, session cookie handling, tenant theme injection, calling the API, Realtime subscriptions | App Router, route groups `(auth)` / `(app)` / `(platform)`, server components fetch `/me/bootstrap`, `@supabase/ssr` for session, `serwist` for SW |
| API core kernel | JWT verification, tenant context resolution, RBAC, module registry/flags, DB lanes, job queue, error/ID conventions | NestJS (module boundaries + DI) or Fastify with encapsulated plugins; `jose` JWKS verify; `pg`/Drizzle with RLS transaction wrapper; `pg-boss` queue |
| Feature modules | One folder per feature: migrations, domain service, HTTP routes, event handlers, UI package | `packages/modules/<name>/{db,server,contracts,ui}` |
| Worker | Async fan-out (notifications), Web Push delivery, link-preview fetch, story expiry housekeeping, media post-processing | Same container image as API, started in worker mode; Cloud Run service with min-instances=1 or Cloud Run Job on schedule |
| Supabase Postgres | Single shared schema, `tenant_id` on every tenant-owned row, RLS as defense in depth, triggers for counters and realtime broadcast | SQL migrations owned by each module, applied by CI |
| Supabase Auth | Identity (email+password, recovery). Does not know about tenants | Optional custom access token hook; not relied upon for authorization |
| Supabase Storage | Private per-purpose buckets, signed upload URLs (TUS for large files), signed serve URLs with image transforms | Bucket paths `tenants/{tenant_id}/{module}/{asset_id}` |
| Supabase Realtime | Fan-out of "something changed" signals on private topics | Broadcast (not Postgres Changes), RLS on `realtime.messages` |
| GitHub Actions | Lint/test, run migrations, deploy Vercel (web) and Cloud Run (api + worker) | Path-filtered workflows per app |

---

## Recommended Project Structure

Monorepo (pnpm workspaces + Turborepo). The module folders are the unit of reuse: each contains everything the feature needs and depends only on `core` and `contracts`, never on sibling modules directly.

```
rede_social/
├── apps/
│   ├── web/                          # Next.js (Vercel)
│   │   ├── app/
│   │   │   ├── (auth)/               # /login /signup/[inviteSlug] /recover
│   │   │   ├── (app)/                # authenticated tenant shell
│   │   │   │   ├── layout.tsx        # fetches /me/bootstrap → ThemeProvider, ModuleNav
│   │   │   │   ├── feed/             # thin route files that mount modules' UI
│   │   │   │   ├── communities/[id]/
│   │   │   │   ├── stories/
│   │   │   │   ├── events/[id]/
│   │   │   │   ├── chat/[conversationId]/
│   │   │   │   ├── notifications/
│   │   │   │   ├── p/[postId]/       # share deep-link target
│   │   │   │   └── admin/            # admin_tenant screens (branding, moderation)
│   │   │   ├── (platform)/           # super_admin panel (tenants, flags, first admin)
│   │   │   ├── manifest.ts           # dynamic: reads tenant branding from session
│   │   │   ├── icon.tsx / favicon    # dynamic per tenant
│   │   │   └── api/                  # ONLY: auth callbacks, realtime token relay, sw helpers
│   │   ├── lib/
│   │   │   ├── api-client.ts         # typed fetch to Cloud Run with user JWT
│   │   │   ├── supabase-server.ts    # @supabase/ssr (auth only)
│   │   │   └── theme.ts              # branding → CSS variables
│   │   ├── proxy.ts                  # session refresh + auth gating (Next 16 name for middleware)
│   │   └── sw.ts                     # serwist service worker (push + shell caching)
│   └── api/                          # Node/TS on Cloud Run
│       ├── src/
│       │   ├── main.ts               # boots http server OR worker based on ROLE env
│       │   ├── app.module.ts         # composes core + enabled modules
│       │   └── http/                 # global filters, versioning, OpenAPI
│       └── Dockerfile
├── packages/
│   ├── core/                         # platform kernel (NOT a feature)
│   │   ├── db/                       # migrations: tenants, users, memberships, tenant_modules,
│   │   │   │                         #   platform_admins, rls helpers, common triggers
│   │   ├── server/
│   │   │   ├── auth/                 # JWKS verify, RequestContext {userId, tenantId, role}
│   │   │   ├── tenancy/              # tenant resolver, membership loader, RLS tx wrapper
│   │   │   ├── rbac/                 # permission matrix, guards/decorators
│   │   │   ├── modules/              # MODULE_REGISTRY, feature-flag guard
│   │   │   ├── db/                   # tenantDb(ctx) lane, adminDb lane
│   │   │   ├── jobs/                 # pg-boss wrapper, job contracts
│   │   │   ├── events/               # in-process domain event bus (typed)
│   │   │   └── realtime/             # topic naming, publish helper (realtime.send)
│   │   └── ui/                       # ThemeProvider, ModuleNav, shell primitives
│   ├── contracts/                    # zod schemas + TS types shared web<->api, per module
│   ├── modules/
│   │   ├── profiles/   { db/ server/ contracts/ ui/ module.ts }
│   │   ├── media/      { db/ server/ contracts/ ui/ module.ts }
│   │   ├── feed/       { db/ server/ contracts/ ui/ module.ts }   # posts, comments, likes
│   │   ├── communities/{ ... }
│   │   ├── stories/    { ... }
│   │   ├── events/     { ... }
│   │   ├── notifications/{ ... }     # in-app + web push
│   │   ├── chat/       { ... }
│   │   ├── moderation/ { ... }
│   │   └── platform/   { ... }       # super_admin tenant provisioning, flags, branding
│   ├── ui/                           # design system (shadcn-style primitives, tokens as CSS vars)
│   └── config/                       # eslint (incl. boundary rules), tsconfig, tailwind preset
├── supabase/
│   ├── config.toml                   # local dev stack
│   └── migrations/                   # GENERATED: concatenated in dependency order from packages/*/db
└── .github/workflows/                # ci.yml, deploy-web.yml, deploy-api.yml, migrate.yml
```

Each module exports a manifest that both apps consume:

```typescript
// packages/modules/feed/module.ts
export const feedModule: ModuleManifest = {
  key: 'feed',                     // stored in tenant_modules.module_key
  version: '1.0.0',
  dependsOn: ['media', 'profiles'],// core is implicit
  nav: { label: 'Feed', icon: 'home', href: '/feed', order: 10 },
  permissions: ['feed.post.create', 'feed.post.delete', 'feed.comment.create', ...],
  defaultRolePermissions: {
    admin_tenant:   ['feed.post.create', 'feed.post.delete', 'feed.comment.*', ...],
    support_tenant: ['feed.comment.create', 'feed.like'],
    member:         ['feed.comment.create', 'feed.like'],   // V2: add 'feed.post.create'
  },
  server: () => import('./server'),   // registers routes, jobs, event handlers
  ui:     () => import('./ui'),       // page components mounted by apps/web route files
  migrations: './db',
};
```

### Structure Rationale

- **`packages/core/` is the kernel, not a module.** Tenancy, identity, RBAC, flags and DB lanes are cross-cutting; every module depends on them and none may bypass them. Reuse in another Rede Social product means: take `core` + the modules you want.
- **`packages/modules/<name>/` holds schema + API + UI together.** This is what "toggle per tenant and reuse elsewhere" requires. Enforce with an ESLint `no-restricted-imports` / boundaries rule: a module may import `core`, `contracts`, `ui`, and its declared `dependsOn` modules' `contracts` only. Cross-module side effects go through the typed domain event bus (e.g. `feed.comment.created` → notifications module handler), never direct service calls.
- **`apps/web/app/**` route files are thin.** They exist for Next.js file-system routing and mount module UI. Business state lives in the API; the web app is a BFF + renderer.
- **`contracts/` is the only thing shared across the wire.** Zod schemas validate API input on Cloud Run and give the web app typed responses without coupling to server code.
- **Migrations live with the module but are applied as one ordered set** (`supabase/migrations` generated by a script that walks `dependsOn`). Supabase CLI and CI see a single linear history; modules stay portable.

---

## Architectural Patterns

### Pattern 1: Shared schema + `tenant_id` everywhere, RLS enforced through the API's own connection

**What:** One Postgres schema. Every tenant-owned table carries `tenant_id uuid not null references tenants(id)`. RLS is enabled on every such table. The API opens each request's work inside a transaction that switches to the `authenticated` role and sets the claims RLS reads. A second, separate "admin lane" uses the service role and is only injectable into the `platform` module and workers.

**Why shared schema (not schema-per-tenant):** ecosystem consensus is unambiguous for SaaS with many small tenants: one schema scales operationally, migrations run once, and RLS closes the "forgot the WHERE" hole. Schema-per-tenant brings per-tenant migration runs, catalog bloat and connection-pool fragmentation, and its extra isolation only pays off under compliance mandates that this product does not have. Custom-domain support later does not require schema separation.

**Why not just trust the API to add `WHERE tenant_id = ?`:** PROJECT.md demands DB-level enforcement. With the API as the only DB client, the failure mode is a developer using the wrong DB handle. The two-lane design makes the safe lane the default and the bypass lane hard to reach.

**How RLS applies when the caller is a backend:** the service role bypasses RLS entirely (Supabase docs), so the tenant lane must not use it. The verified pattern (Supabase collaborator answer in discussion #30124; used by Supabase's own test tooling) is to connect with a role that can `SET ROLE authenticated` and, inside a transaction, set `request.jwt.claims` and switch role. Use `set_config(..., true)` / `SET LOCAL` so the settings die with the transaction; this is mandatory when the connection comes from Supavisor in transaction mode, otherwise a pooled connection leaks one request's tenant into the next.

**Example:**

```typescript
// packages/core/server/db/tenant-db.ts
export async function withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return pool.transaction(async (tx) => {
    // Claims RLS will read. Only the API can set these; the JWT is NOT the source of truth.
    const claims = JSON.stringify({
      sub: ctx.userId,
      role: 'authenticated',
      tenant_id: ctx.tenantId,       // from memberships, resolved per request
      tenant_role: ctx.role,         // admin_tenant | support_tenant | member
      platform_role: ctx.platformRole ?? null,
    });
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await tx.query(`set local role authenticated`);
    return fn(tx);
  });
}
```

```sql
-- packages/core/db/0002_rls_helpers.sql
create or replace function app.tenant_id() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id', '')::uuid
$$;
create or replace function app.tenant_role() returns text language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_role'
$$;

-- Standard policy every tenant table gets (generated by a helper macro in migrations):
alter table feed.posts enable row level security;
create policy tenant_isolation on feed.posts
  using (tenant_id = app.tenant_id())
  with check (tenant_id = app.tenant_id());
```

**Trade-offs:** slight per-request overhead (two SET statements); RLS policies must stay simple (`tenant_id = app.tenant_id()` is index-friendly; avoid subselects on hot paths). Postgres RLS is defense in depth, not the primary authorization layer, so keep role-based rules in the API's RBAC and only mirror the coarse "same tenant" rule in SQL. Blocking a member takes effect immediately because the API reads membership status per request (no stale JWT claim).

### Pattern 2: Identity is global, membership is per tenant

**What:** `users` (mirrors `auth.users`, one per person) and `memberships (user_id, tenant_id, role, status)`. A user's tenant is *derived* from memberships, never stored on the user. V1 enforces exactly one active membership per user with a partial unique index; V2 drops that index and adds a tenant switcher. `super_admin` lives in a separate `platform_admins` table because it is not a tenant role.

**Example:**

```sql
create table core.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                 -- used in public sign-up link /signup/{slug}
  display_name text not null,
  branding jsonb not null default '{}'::jsonb, -- {logoAssetId, faviconAssetId, colors:{primary,...}}
  plan text not null default 'pilot',        -- billing later
  status text not null default 'active',     -- active | suspended
  created_at timestamptz not null default now()
);

create table core.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table core.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  user_id uuid not null references core.users(id),
  role text not null check (role in ('admin_tenant','support_tenant','member')),
  status text not null default 'active' check (status in ('active','blocked','invited')),
  joined_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
-- V1 rule: one tenant per user. Dropping this index is the entire V2 migration for multi-tenancy.
create unique index memberships_one_tenant_per_user_v1 on core.memberships(user_id);

create table core.platform_admins (user_id uuid primary key references core.users(id));
```

**Trade-offs:** Slightly more joins than a `users.tenant_id` column; in exchange, V2 multi-tenancy is an index drop plus UI. Profile data (`profiles.display_name, avatar, bio`) should hang off `memberships` (profile per tenant) rather than `users` if a person may present differently per tenant; if simplicity wins, put it on `users` and accept one profile across tenants. Recommendation: **profile on membership** (tenant-scoped, matches "members view each other's profiles within the same tenant").

### Pattern 3: Module registry + per-tenant flags drive both API guards and navigation

**What:** Code declares modules (`MODULE_REGISTRY`), the DB records which are enabled per tenant (`tenant_modules`), and one bootstrap call gives the web app everything it needs to render the shell.

```sql
create table core.tenant_modules (
  tenant_id uuid not null references core.tenants(id),
  module_key text not null,                  -- 'feed','communities','stories','events','chat','notifications'
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb, -- module-specific knobs (e.g. stories.ttlHours)
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_key)
);
```

```typescript
// API: every module route is guarded
@UseGuards(ModuleEnabledGuard('events'))   // 404 when disabled for ctx.tenantId
@Controller('events') export class EventsController { ... }

// Web: GET /me/bootstrap
type Bootstrap = {
  user: { id; email };
  membership: { tenantId; role; profile: { displayName; avatarUrl; bio } };
  tenant: { id; slug; displayName; branding: { logoUrl; faviconUrl; colors: Record<string,string> } };
  modules: Array<{ key; nav?: {...}; settings }>;   // only enabled ones, in nav order
  permissions: string[];                            // resolved from role + module defaults
  counters: { unreadNotifications: number; unreadConversations: number };
};
```

**When to use:** always; this is the seam that makes "toggle per tenant" real. Plans (later) become a mapping from `plan` to a default flag set applied at provisioning.

**Trade-offs:** flags are consulted on every request (cache per tenant in-process for ~30 s; invalidate on platform update). Disabling a module hides routes and nav but leaves data in place: re-enabling restores everything.

### Pattern 4: Login → tenant → theme (single URL, no hostname)

**Flow:**

```
1. /login (public, unbranded Rede Social neutral chrome)
2. Next.js server action → Supabase Auth signInWithPassword (@supabase/ssr) → session cookies (httpOnly)
3. redirect → /(app)/layout.tsx  (server component)
4. layout: apiFetch('/me/bootstrap', { jwt: session.access_token })
     API: verify JWT (JWKS) → load memberships → status blocked? 403 → choose tenant (V1: the only one)
          → load tenant + branding + tenant_modules → resolve permissions → counters
5. layout renders <html style="--color-primary: …; --color-bg: …"> + <ThemeProvider> + <ModuleNav>
   manifest.ts / icon.tsx read the same bootstrap (cached per request) so the installed PWA carries tenant name/icon
6. client mounts Realtime with the access token → subscribes tenant:{id}:user:{userId} and tenant:{id}:feed
```

Public sign-up: `/signup/{tenantSlug}` is the only place a tenant is known before login. The page posts to the API `POST /public/signup {slug, email, password, name}`; the API (admin lane) creates the auth user, `users` row and `memberships` row atomically, then the web app signs the user in. Invite links for staff roles use the same endpoint with a signed invite token that carries the role.

Custom domains later: a hostname → tenant hint can pre-select branding on the login page; nothing else changes because tenant resolution is already account-based.

**Theming implementation:** branding colors are stored as a small token set (`primary`, `onPrimary`, `surface`, `accent`, ...) and injected as CSS custom properties inline in the authenticated layout; Tailwind utilities map to `var(--color-primary)`. Single stylesheet, no per-tenant CSS build, no flash of wrong theme because the server renders the variables. Logo/favicon are `media_assets` served through signed URLs with a long TTL.

### Pattern 5: Separate content tables + nullable-FK "exactly one target" for shared behaviors

**What:** Posts, stories, comments and events are separate tables (they differ in lifecycle and columns). Shared behaviors (likes, comments, media attachments, notifications' references) use nullable foreign keys with a `CHECK (num_nonnulls(...) = 1)` rather than `target_type/target_id`. This keeps real FK integrity, cascades, and index use, which polymorphic ids lose (GitLab's database guidelines say the same).

```sql
-- feed module
create table feed.posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  author_user_id uuid not null references core.users(id),     -- never "the admin": V2-ready
  community_id uuid references communities.communities(id),   -- null = tenant-wide feed
  body text,
  link_preview jsonb,                                         -- {url,title,description,imageUrl,provider}
  embed jsonb,                                                -- {provider:'youtube'|'vimeo', id, url}
  status text not null default 'published' check (status in ('draft','published','hidden','deleted')),
  like_count int not null default 0, comment_count int not null default 0,  -- trigger-maintained
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on feed.posts (tenant_id, published_at desc) where status = 'published';
create index on feed.posts (tenant_id, community_id, published_at desc) where status = 'published';

create table feed.post_media (      -- ordered attachments; media rows are owned by the media module
  post_id uuid references feed.posts(id) on delete cascade,
  media_asset_id uuid references media.assets(id),
  position smallint not null,
  primary key (post_id, media_asset_id)
);

create table feed.comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  author_user_id uuid not null references core.users(id),
  post_id uuid references feed.posts(id) on delete cascade,
  story_id uuid references stories.stories(id) on delete cascade,
  parent_comment_id uuid references feed.comments(id) on delete cascade,  -- one level only
  body text not null,
  status text not null default 'visible' check (status in ('visible','deleted_by_author','deleted_by_moderator')),
  like_count int not null default 0,
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, story_id) = 1),
  -- story comments cannot be replies (product rule)
  check (story_id is null or parent_comment_id is null)
);
create index on feed.comments (post_id, created_at) where parent_comment_id is null;
create index on feed.comments (parent_comment_id, created_at);
-- depth<=1: trigger rejects insert when the parent itself has a parent (cannot be expressed as CHECK)

create table feed.likes (
  tenant_id uuid not null references core.tenants(id),
  user_id uuid not null references core.users(id),
  post_id uuid references feed.posts(id) on delete cascade,
  comment_id uuid references feed.comments(id) on delete cascade,
  story_id uuid references stories.stories(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id, story_id) = 1)
);
create unique index likes_once_post    on feed.likes (user_id, post_id)    where post_id is not null;
create unique index likes_once_comment on feed.likes (user_id, comment_id) where comment_id is not null;
create unique index likes_once_story   on feed.likes (user_id, story_id)   where story_id is not null;
-- likes on story *comments* are forbidden by an API rule + trigger (comment.story_id is not null → reject)
```

Stories are a sibling table, not a post variant: different expiry, different rendering, no replies, pinning.

```sql
create table stories.stories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  author_user_id uuid not null references core.users(id),
  media_asset_id uuid not null references media.assets(id),
  caption text,
  published_at timestamptz not null default now(),
  expires_at timestamptz not null,               -- set by API: published_at + tenant_modules.settings.stories.ttlHours (default 24)
  status text not null default 'published' check (status in ('published','hidden','deleted')),
  like_count int not null default 0, comment_count int not null default 0
);
create index on stories.stories (tenant_id, expires_at desc) where status = 'published';

create table stories.community_pins (            -- "pin a story to a community"
  story_id uuid references stories.stories(id) on delete cascade,
  community_id uuid references communities.communities(id) on delete cascade,
  pinned_by uuid not null references core.users(id),
  pinned_at timestamptz not null default now(),
  primary key (story_id, community_id)
);
```

Expiry is **soft**: the strip query is `where expires_at > now()`; nothing is deleted. Product ambiguity to settle in the stories phase: whether a pinned story remains visible in the community after `expires_at` (recommended: yes, pins outlive the 24 h strip, which is the reason to keep the record).

Communities: `communities.communities (tenant_id, name, description, cover_asset_id, created_by, status)` plus `communities.members (community_id, user_id, role in ('owner','moderator','member'), joined_at)` from day one. V1 can leave every community open (no membership required to read); the table exists so V2 "members create communities" and private communities need no schema change.

Events:

```sql
create table events.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  community_id uuid references communities.communities(id),
  created_by uuid not null references core.users(id),
  title text not null, description text, cover_asset_id uuid references media.assets(id),
  kind text not null check (kind in ('in_person','online')),
  location jsonb,           -- {address, mapsUrl}  (in_person)
  online_url text,          -- (online)
  starts_at timestamptz not null, ends_at timestamptz,
  checkin_opens_at timestamptz, checkin_closes_at timestamptz,   -- defaults: starts_at - 1h .. ends_at
  status text not null default 'published' check (status in ('draft','published','cancelled'))
);
create table events.attendances (
  event_id uuid references events.events(id) on delete cascade,
  user_id uuid references core.users(id),
  tenant_id uuid not null references core.tenants(id),
  status text not null check (status in ('going','not_going','checked_in')),
  rsvp_at timestamptz not null default now(),
  checked_in_at timestamptz,
  primary key (event_id, user_id)
);
```

One row per user per event; RSVP and check-in are state transitions on the same row, so "confirmed vs checked-in" is a `group by status`. Check-in in V1 is a button the member presses inside the check-in window (the API validates the window); QR/geofence can be added as an alternative transition later.

### Pattern 6: Generic conversations, with "support" as a conversation kind

```sql
create table chat.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  kind text not null check (kind in ('support','direct','group')),
  title text,                                  -- group only
  direct_key text,                             -- 'direct' only: sorted "userA:userB", unique per tenant
  created_by uuid not null references core.users(id),
  last_message_at timestamptz, last_message_preview text,   -- denormalized for inbox sorting
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  unique (tenant_id, direct_key)
);
create table chat.participants (
  conversation_id uuid references chat.conversations(id) on delete cascade,
  user_id uuid references core.users(id),
  tenant_id uuid not null references core.tenants(id),
  role text not null default 'member' check (role in ('member','agent','owner')),  -- 'agent' = support staff
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
create table chat.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat.conversations(id) on delete cascade,
  tenant_id uuid not null references core.tenants(id),
  sender_id uuid not null references core.users(id),
  body text, media_asset_id uuid references media.assets(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz, deleted_at timestamptz
);
create index on chat.messages (conversation_id, created_at desc);
```

V1 support semantics, expressed purely in API rules, not schema:

- A member has at most one `open` support conversation (partial unique index on `(tenant_id, created_by) where kind='support' and status='open'`).
- Participants are the member (`member`) plus support staff. The support inbox lists all `kind='support'` conversations of the tenant for anyone with `support_tenant`/`admin_tenant`; staff are added as `agent` participants when they first reply. This gives a shared team inbox without a separate "assignment" model; add `assigned_to` later if needed.
- Unread = messages with `created_at > participants.last_read_at` for that user.
- V2 direct/group chat = allow `kind in ('direct','group')` in the create endpoint and expose UI. No migration.

### Pattern 7: Fan-out on write notifications, async, with push as a channel

```sql
create table notifications.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  recipient_user_id uuid not null references core.users(id),
  actor_user_id uuid references core.users(id),
  type text not null,        -- 'post.liked','comment.liked','comment.replied','post.commented','post.published','event.published','event.reminder','chat.message'
  post_id uuid references feed.posts(id) on delete cascade,
  comment_id uuid references feed.comments(id) on delete cascade,
  story_id uuid references stories.stories(id) on delete cascade,
  event_id uuid references events.events(id) on delete cascade,
  conversation_id uuid references chat.conversations(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,     -- rendered text bits (actor name, snippet) frozen at creation
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_unread on notifications.notifications (recipient_user_id, created_at desc) where read_at is null;
create index notifications_inbox  on notifications.notifications (recipient_user_id, created_at desc);

create table notifications.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  tenant_id uuid not null references core.tenants(id),
  endpoint text not null unique,
  keys jsonb not null,          -- {p256dh, auth}
  user_agent text,
  created_at timestamptz not null default now(), last_seen_at timestamptz, failure_count int not null default 0
);
create table notifications.preferences (user_id uuid, tenant_id uuid, type text, in_app boolean default true, push boolean default true, primary key (user_id, tenant_id, type));
```

Flow: a module emits a domain event (`feed.comment.created`) → notifications module handler enqueues a `notify` job (pg-boss, Postgres-backed, no Redis needed at this scale) → worker resolves recipients (comment author for replies; post author for comments; **all active tenant members** for `post.published`, done as a single `insert ... select from core.memberships where tenant_id=$1 and status='active'`) → inserts rows → per recipient, a Postgres trigger on `notifications` calls `realtime.send(...)` on `tenant:{tid}:user:{uid}` with `{type:'notification', id}` → worker also enqueues `push.send` jobs for recipients with subscriptions and preference `push=true`; `web-push` sends; 404/410 responses delete the subscription. Unread count = `count(*) where recipient=$1 and read_at is null` (indexed, cheap at this scale); denormalize into a counter only if a tenant exceeds tens of thousands of members.

"New post" to every member is the one broadcast-style notification; keep it, but consider collapsing (max one "new posts" notification per hour per member) in the notifications phase to avoid bell fatigue.

### Pattern 8: Direct-to-Storage uploads brokered by the API

```
client → POST /media/uploads {kind:'image'|'video'|'file', mime, sizeBytes, purpose:'post'|'story'|'avatar'|'chat'}
API    → validates mime allowlist + size cap per kind and per tenant plan
       → inserts media.assets {status:'pending', bucket, path:'tenants/{tid}/{purpose}/{assetId}.{ext}'}
       → storage.createSignedUploadUrl(bucket, path)  (admin lane; private bucket)
       ← { assetId, uploadUrl, token, resumable: sizeBytes > 6MB }
client → PUT signed URL (small) or TUS to {project}.storage.supabase.co/storage/v1/upload/resumable with x-signature: token (large, 6 MB chunks, resumable on mobile)
client → POST /media/uploads/{assetId}/complete
API    → HEAD/info the object, verify size/mime, set status:'ready', width/height for images, duration for video (from client metadata, trusted loosely)
       → enqueue media.process (video: none in V1 beyond validation; image: nothing, transforms happen on read)
```

Serving: buckets are **private**; API list responses include signed serve URLs generated per asset with a long TTL (e.g. 7 days) and, for images, transform params (`width`, `quality`) embedded in the signed token so the client cannot request arbitrary sizes. Image transformations require Supabase Pro (not on Free). Video: Supabase does no transcoding; V1 plays uploaded MP4/WebM natively with a size cap (recommend 200 MB, Pro plan) and requires the client to produce a poster via `<video>` or the API to store a client-provided thumbnail; if adaptive streaming becomes necessary, plug Mux or Cloudflare Stream behind the same `media.assets` row (`provider:'supabase'|'mux'`, `provider_ref`). Link previews: the API fetches OG metadata server-side in a worker job with an SSRF allow-list (no private IPs, size/time caps) and writes `posts.link_preview`.

`media.assets` is the only table other modules reference; it carries `tenant_id`, `owner_user_id`, `purpose`, `status`, dimensions, `provider`, and is RLS-scoped like everything else.

### Pattern 9: Realtime = Supabase Broadcast on private topics, signals only, data from the API

**Decision:** use Supabase Realtime **Broadcast** (not Postgres Changes, not a Cloud Run WebSocket server).

- Postgres Changes runs one RLS check per subscriber per change on a single thread; Supabase's own docs point to Broadcast beyond ~3,000 subscribers on the same change. The feed pattern ("one post → every member") is exactly that shape.
- Cloud Run WebSockets work but each connection counts against the 60-minute request timeout, affinity is best-effort, and multi-instance fan-out needs Memorystore/Redis. That is a second stateful system for no gain when Supabase already runs one.
- Broadcast is a transport. Payloads are `{type, id}`; clients refetch through the API. So the "frontend never reads Supabase data" rule holds in spirit, and authorization on data stays in one place.

Topics and who publishes:

| Topic | Event payload | Subscribers | Publisher |
|-------|---------------|-------------|-----------|
| `tenant:{tid}:user:{uid}` | `notification {id}`, `chat.message {conversationId, messageId}`, `membership.changed` | that user | trigger on `notifications`, `chat.messages`; API on block |
| `tenant:{tid}:conv:{cid}` | `message {id}`, `typing {userId}` (client→client presence) | participants | trigger on `chat.messages`; clients for typing |
| `tenant:{tid}:feed` | `post.published {id}`, `post.updated {id}` | all tenant members | trigger on `feed.posts` |
| `tenant:{tid}:support-inbox` | `conversation.updated {id}` | support staff | trigger on `chat.conversations` |

Authorization: private channels + RLS on `realtime.messages` that joins `core.memberships` (and `chat.participants` for conversation topics) using `auth.uid()` from the user's Supabase JWT. Topic names embed `tenant_id` so a policy can parse it (`split_part(realtime.topic(), ':', 2)::uuid`). Disable "Allow public access" in Realtime settings. The client re-sends the token on refresh (policies are cached per connection; keep access-token lifetime short, e.g. 1 h).

Publisher side: `realtime.send(payload, event, topic, false)` in `AFTER INSERT` triggers keeps delivery consistent with commits without any API code path. The API may also publish via a `select realtime.send(...)` in the tenant transaction for non-table events (typing indicators go client→client and never touch the DB).

Fallback if Realtime is ever removed: the same topic vocabulary served over SSE from Cloud Run with a Redis pub/sub bridge. Nothing in modules changes because they only ever call `core/realtime.publish(topic, event, payload)`.

---

## Data Flow

### Request Flow

```
[Member taps "like" on post 123]
    ↓ client: optimistic toggle
POST /feed/posts/123/like   Authorization: Bearer <supabase access token>
    ↓ core: verify JWT (jose + cached JWKS) → userId
    ↓ core: load membership (cache 30 s) → tenantId, role, status (blocked → 403)
    ↓ core: ModuleEnabledGuard('feed') → tenant_modules cache
    ↓ core: RBAC permission 'feed.like'
    ↓ feed.service.like(ctx, postId)
        withTenantTx(ctx) → set_config(claims) → SET LOCAL ROLE authenticated
          insert into feed.likes ...  (RLS: tenant_id must equal app.tenant_id())
          trigger: posts.like_count += 1
          domain event: feed.post.liked {postId, actorId, authorId}
    ↓ notifications handler (in-process) → enqueue job 'notify' (pg-boss, same transaction via pg-boss's tx support)
    ← 200 {liked: true, likeCount: 42}
[worker] notify job → insert notifications row → trigger realtime.send('tenant:T:user:AUTHOR', 'notification', {id})
[author's client] receives signal → GET /notifications?since=… → bell badge updates
[worker] push.send job → web-push to author's subscriptions → SW shows toast
```

### State Management (web)

```
Server components (per request):  /me/bootstrap → tenant, modules, permissions, theme  (React cache() dedup)
Client state:                     TanStack Query (or SWR) keyed by tenant+resource for lists/detail,
                                  optimistic mutations for like/comment/rsvp/send-message
Realtime bridge:                  a single provider subscribes to the user + feed topics and
                                  invalidates the matching query keys; never writes data from payloads
Service worker:                   push display + notificationclick deep link → /p/{postId}, /chat/{id}
```

### Key Data Flows

1. **Provisioning (super_admin):** platform panel → `POST /platform/tenants` (admin lane) → tenant row, default `tenant_modules` (all disabled or plan defaults), branding assets → `POST /platform/tenants/{id}/admins` creates auth user + membership `admin_tenant` → invite email (Supabase Auth invite or magic link).
2. **Sign-up via public link:** `/signup/{slug}` → `POST /public/signup` → admin lane creates auth user + `users` + `memberships(member)` → web signs in → bootstrap.
3. **Branding change:** admin uploads logo (media flow) → `PATCH /tenants/me/branding` → next bootstrap carries new tokens; `manifest.ts` and `icon.tsx` are dynamic routes reading bootstrap, so the installed PWA updates on next launch.
4. **Story lifecycle:** create (media + row with `expires_at`) → strip query filters by `expires_at > now()` → optional pin to community → after expiry: hidden from strip, remains in DB and (recommended) in community pins; admin history view lists all.
5. **Support chat:** member opens chat → API gets-or-creates open `support` conversation → messages insert → trigger broadcasts to `conv:{id}` and to the tenant `support-inbox` → staff replies → member's `user:{uid}` topic pinged + push.
6. **Share deep link:** share sheet gets `https://app.seusistema.com/p/{postId}`; unauthenticated hit → `/login?next=/p/{postId}`; after login the API 404s if the post's tenant is not the user's tenant (RLS makes it invisible), so cross-tenant links leak nothing.
7. **Block member:** `PATCH /moderation/members/{id} {status:'blocked'}` → membership status → next request 403; API publishes `membership.changed` on the user's topic so an open session logs out immediately; Realtime policies re-evaluate on next token refresh (short TTL bounds the window).

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Pilot: 1 tenant, <1k members | Everything above as-is. Cloud Run API min-instances 1 (cold starts hurt mobile UX), worker min-instances 1. Supabase Pro (needed for image transforms and >50 MB files). Free-tier Realtime caps (200 concurrent connections) would bite even here; Pro gives 500. |
| 10–50 tenants, up to ~20k members total | Add per-tenant flag/branding cache with pub/sub invalidation; Realtime concurrent-connection quota becomes the first hard limit (500 on Pro; buy add-on or negotiate). Move "new post to all members" notifications to batched/collapsed rows. Consider a read replica only if feed queries dominate. Cloud Run scale-to-N is automatic; pg-boss handles thousands of jobs/min on Postgres. |
| 100k+ members / large tenants | Partition `notifications` and `chat.messages` by tenant or time; move media serving behind a CDN with signed cookies; consider Mux/Cloudflare Stream for video; split worker into per-queue services; evaluate dedicated Realtime or an SSE gateway. Shared-schema stays; the biggest tenants can be moved to a second Supabase project ("cell") because the API already resolves tenant → connection at request start. |

### Scaling Priorities

1. **First bottleneck: Realtime connections and messages/second.** Every open PWA holds one connection and subscribes to 2–3 topics. Mitigate by subscribing lazily (feed topic only while the feed is visible), by keeping payloads tiny, and by sizing the plan. Fallback path (SSE from Cloud Run) is designed in.
2. **Second bottleneck: notification fan-out writes** for `post.published` in big tenants. Mitigate with single-statement `insert ... select`, batching, and collapsing; then partitioning.

---

## Anti-Patterns

### Anti-Pattern 1: `users.tenant_id` column

**What people do:** put the tenant directly on the user because "one tenant per user" is the V1 rule.
**Why it's wrong:** V2 multi-tenant membership becomes a rewrite of every join and RLS policy.
**Do this instead:** `memberships` join table plus a partial unique index that encodes the V1 rule and is dropped in V2.

### Anti-Pattern 2: Using the service role as the API's default DB connection

**What people do:** the backend "is trusted", so it uses the service key everywhere and filters by `tenant_id` in code.
**Why it's wrong:** RLS is bypassed entirely; one missed filter leaks across tenants, and PROJECT.md requires DB-level enforcement.
**Do this instead:** two DB lanes; tenant lane sets claims and `SET LOCAL ROLE authenticated` inside a transaction (`is_local = true`, pool-safe); admin lane only injectable into `platform` and workers, enforced by DI scoping and a lint rule.

### Anti-Pattern 3: Treating JWT custom claims (tenant, role) as the authorization source

**What people do:** add `tenant_id`/`role` via the custom access token hook and trust them in the API.
**Why it's wrong:** claims only change on token refresh; blocking a member or changing a role lags up to the token lifetime. Supabase's docs state the hook does not update the auth response either.
**Do this instead:** the API reads `memberships` per request (short in-process cache) and injects the claims RLS needs itself. Use the auth hook only if a Realtime policy truly needs a claim that cannot be derived from `auth.uid()` joins (it can, so skip it in V1).

### Anti-Pattern 4: Polymorphic `target_type`/`target_id` for likes and comments

**What people do:** one `likes(target_type, target_id)` table.
**Why it's wrong:** no foreign keys, no cascades, worse index selectivity, orphan rows after deletions.
**Do this instead:** nullable FKs + `CHECK (num_nonnulls(...) = 1)` + partial unique indexes (Pattern 5).

### Anti-Pattern 5: Postgres Changes for feed/notifications

**What people do:** subscribe to `postgres_changes` on `posts` filtered by tenant.
**Why it's wrong:** one RLS evaluation per subscriber per change on a single thread; also tempts the client to render data straight from the change payload, bypassing the API.
**Do this instead:** Broadcast on private topics with id-only payloads; refetch through the API.

### Anti-Pattern 6: Hostname-based tenant resolution "because every guide does it"

**What people do:** parse the subdomain in `proxy.ts`/middleware.
**Why it's wrong:** the product requirement is a single URL; hostname logic would create a second source of truth that later conflicts with the account-based one.
**Do this instead:** account → membership → tenant. If custom domains arrive, hostname becomes a *hint* for the login page branding only.

### Anti-Pattern 7: Uploading media through the API

**What people do:** multipart POST to Cloud Run, then the server pushes to Storage.
**Why it's wrong:** doubles bandwidth, hits request-size/timeout limits with video, blocks instances, no resumability on flaky mobile networks.
**Do this instead:** API brokers signed upload URLs (Pattern 8); TUS for >6 MB.

### Anti-Pattern 8: Inline fan-out in the request

**What people do:** insert N notification rows and send N pushes inside the "create post" request.
**Why it's wrong:** latency scales with member count; push failures roll back or get lost; retries are impossible.
**Do this instead:** domain event → job → worker; idempotent jobs keyed by `(event, entity id)`.

### Anti-Pattern 9: Hard-deleting stories or moderated content

**What people do:** `DELETE` on expiry / moderation.
**Why it's wrong:** breaks pins, counters, notification references, audit needs.
**Do this instead:** `status`/`expires_at` columns; queries filter; cron never deletes in V1.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase Auth | Next.js server via `@supabase/ssr` for sign-in/refresh/recovery; API admin lane (`auth.admin.*`) for provisioning; API verifies access tokens with `jose` against `/auth/v1/.well-known/jwks.json` | Requires asymmetric JWT signing keys enabled in the project (JWKS is empty otherwise). Cache JWKS no longer than 10 min. Keep access token TTL short (Realtime policy refresh). |
| Supabase Postgres | API only, via Supavisor pooler (transaction mode) using a dedicated role that can `SET ROLE authenticated`; service role for admin lane | All session state must be `SET LOCAL`. Migrations via Supabase CLI from CI (`migrate.yml`) before deploying the API. |
| Supabase Storage | API creates signed upload URLs; browser uploads (PUT or TUS with `x-signature`); API generates signed serve URLs with transforms | Private buckets per purpose (`media`, `avatars`, `branding`, `chat`); per-bucket mime and size limits; image transforms need Pro; no video transcoding. |
| Supabase Realtime | Browser subscribes to private topics with the user JWT; DB triggers `realtime.send`; RLS on `realtime.messages` | Disable public access; quotas per plan; 256 KB (Free) / 3 MB (Pro) broadcast payload limits are irrelevant for id-only events. |
| Web Push | `web-push` (VAPID) from the worker; subscriptions stored per user; SW handles `push` and `notificationclick` | iOS 16.4+ only when installed to home screen: show an install prompt before asking for push permission. Serve `sw.js` with no-cache headers. |
| Vercel | Git-integrated deploy of `apps/web`; env: API base URL, Supabase URL + anon key (for auth/realtime only), VAPID public key | Preview deployments should point at a staging API + staging Supabase project. |
| Cloud Run | GitHub Actions builds one image, deploys `api` (HTTP) and `worker` (ROLE=worker, min-instances 1) | Workload Identity Federation for keyless deploy; secrets in Secret Manager. |
| Optional later: Mux / Cloudflare Stream | `media.assets.provider` + webhook to mark ready | Only if adaptive streaming or transcoding is demanded. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| web ↔ api | HTTPS JSON, `contracts` zod types, user JWT bearer | No shared runtime code beyond `contracts` and `ui`. |
| module ↔ module (server) | Typed in-process domain events (`core/events`), plus read-only use of another module's `contracts` | No direct service imports across modules; enforced by ESLint boundaries. Notifications is the main consumer of events. |
| module ↔ core | Direct imports of `core` APIs (`withTenantTx`, `rbac`, `jobs`, `realtime.publish`, `media` reference types) | Core has no knowledge of modules except through `MODULE_REGISTRY` registration. |
| api ↔ worker | pg-boss queues in Postgres; job contracts in `core/jobs` | Same image; jobs are idempotent and tenant-scoped. |
| db schemas | One Postgres schema per module (`core`, `feed`, `stories`, …) for namespacing only, not isolation | FKs may cross schemas (`feed.posts.community_id → communities.communities`). Migration order follows `dependsOn`. |

---

## Suggested Build Order

Dependencies decide the order; each step is deployable and testable on its own.

```
0. Repo skeleton ─ monorepo, CI (lint/test/migrate), deploy web + api + worker, envs (local Supabase, staging, prod)
        │
1. Core kernel ─ tenants, users, memberships, platform_admins, RLS helpers + tenant lane, JWT verify,
   │             module registry + tenant_modules, /me/bootstrap, auth flow (login/recovery via @supabase/ssr,
   │             signup via API), theme injection, dynamic manifest/icon, platform panel (create tenant,
   │             branding, flags, first admin_tenant), moderation.block (it is a membership status)
        │
2. Media ─ assets table, signed upload/serve, TUS, limits, link-preview job     ← feed/stories/profiles need it
        │
3. Profiles ─ per-membership profile, avatar, member directory/view              (small; can pair with 2)
        │
4. Feed ─ posts (tenant-wide), media attachments, embeds, comments (1 level), likes, share deep link
   │       establishes the content/likes/comments conventions every later module reuses
        │
5. Communities ─ communities + members table, community-scoped posts, community pages
        │
6. Stories ─ stories, strip, soft expiry, likes/comments (no replies), community pins (needs 5)
        │
7. Events ─ events, RSVP, check-in window, attendance list (needs 5 for community events, optional)
        │
8. Notifications (in-app) ─ event handlers for 4–7, worker fan-out, bell + unread, Realtime infra
   │                        (private topics, RLS on realtime.messages, triggers) is introduced here
        │
9. Web Push + PWA hardening ─ SW, subscriptions, install prompt, notificationclick deep links
        │
10. Chat ─ conversations/participants/messages, support inbox, realtime on conv topics, chat notifications (needs 8)
        │
11. Moderation UI ─ delete comment/reply (status change), block member screen, admin views  (data rules exist since 1/4)
        │
12. Pilot hardening ─ i18n string extraction (pt-BR catalogue), a11y, perf, cell/plan fields, backups
```

Ordering rationale:

- **Core before anything:** every module's tests need a tenant, a member, RLS and flags. Blocking a member is a membership status change, so it belongs to core, not to a late "moderation" phase.
- **Media before feed:** posts, stories, avatars and branding all attach assets; building the broker once avoids three upload paths.
- **Feed before communities and stories:** comments and likes conventions (nullable-FK targets, counters, one-level replies) are proven on posts, then reused.
- **Notifications after the producers exist** (feed, communities, stories, events), and it is the natural place to stand up Realtime, because the bell is the simplest realtime consumer.
- **Chat after notifications** because it reuses realtime topics, the worker, push, and the unread-count patterns.
- **Moderation UI late but moderation data early:** `status` columns and membership `status` are in the schema from day one so nothing needs migrating; the admin screens are thin.

Phases likely needing their own deeper research: Core (RLS-in-transaction with Supavisor, JWKS setup, auth hook decision), Media (TUS on mobile Safari, video size policy), Notifications/Realtime (RLS policy shape on `realtime.messages`, quota sizing), Web Push (iOS install gating, SW with Serwist under Turbopack).

---

## Confidence Notes

The `classify-confidence` seam rated `webfetch` as LOW (verified or not) and `websearch --verified` as MEDIUM; it has no signal to distinguish official vendor documentation from arbitrary pages. Applied honestly:

| Claim area | Seam tier | Assessment | Basis |
|------------|-----------|------------|-------|
| RLS bypass by service role; `set_config('request.jwt.claims')` + `SET ROLE authenticated` pattern | LOW (webfetch) / MEDIUM (cross-checked) | Strong | Supabase official docs + Supabase collaborator answer (discussion #30124, Oct 2024, refined through Nov 2025); the `is_local`/transaction subtlety must be validated in the Core phase against Supavisor transaction mode |
| Realtime private channels, RLS on `realtime.messages`, `realtime.send` / `broadcast_changes`, Postgres Changes per-subscriber cost, quotas | LOW (webfetch) | Strong | Supabase official docs (Authorization, Broadcast, Postgres Changes, Limits pages) |
| Storage signed upload + TUS (`x-signature`, 6 MB chunks, 24 h), file limits per plan, image transforms Pro-only | LOW (webfetch) | Strong | Supabase official docs |
| No video transcoding in Supabase; Mux/Cloudflare Stream as add-ons | MEDIUM (websearch, multiple sources incl. Supabase discussions and partner page) | Good | Verify current roadmap status before committing to a video policy |
| Next.js PWA + web-push flow, iOS 16.4+ home-screen requirement, Serwist | LOW (webfetch) | Strong | Next.js official guide, v16.3.4, updated 2026-07-30 |
| Cloud Run WebSockets: 60-min timeout, best-effort affinity, need Redis across instances | MEDIUM (websearch, Google docs listed among sources) | Good | Direct doc fetch failed (404 after redirect); corroborated by multiple secondary sources quoting the docs |
| Shared schema vs schema-per-tenant; memberships join table | MEDIUM (websearch) | Good, consensus | ClickHouse engineering, PlanetScale, several 2026 guides agree |
| Modular monolith framework fit (NestJS enforced boundaries vs Fastify/Hono) | MEDIUM (websearch) | Fair | Framework choice belongs to STACK.md; the layout here is framework-agnostic |
| Nullable-FK + CHECK over polymorphic ids | MEDIUM (websearch) | Good | GitLab database guidelines + practitioner posts |
| Fan-out-on-write notifications, chat schema shape, CSS-variable theming | MEDIUM (websearch) | Good, consensus | Multiple independent sources; nothing controversial |

Not verified and flagged for phase research: exact Supavisor behavior with `SET LOCAL ROLE` under transaction pooling (design assumes it works as Supabase's testing docs describe); whether `pg-boss` transactional enqueue fits the chosen DB layer; Supabase Realtime add-on pricing for connection quotas beyond Pro.

---

## Sources

Official documentation (fetched directly):

- Supabase Realtime Authorization: https://supabase.com/docs/guides/realtime/authorization
- Supabase Realtime Broadcast (incl. "Broadcast from the Database"): https://supabase.com/docs/guides/realtime/broadcast
- Supabase Realtime Postgres Changes (limitations): https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase Realtime Limits: https://supabase.com/docs/guides/realtime/limits
- Supabase Storage Resumable Uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Supabase Storage File Limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase Storage Image Transformations: https://supabase.com/docs/guides/storage/serving/image-transformations
- Supabase Custom Access Token Hook: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Supabase Custom Claims & RBAC: https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
- Supabase JWTs (JWKS verification): https://supabase.com/docs/guides/auth/jwts
- Supabase discussion #30124, running queries as an authenticated user over a direct connection: https://github.com/orgs/supabase/discussions/30124
- Supabase troubleshooting, service role and RLS: https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z
- Next.js PWA guide (v16.3.4, 2026-07-30): https://nextjs.org/docs/app/guides/progressive-web-apps
- Google Cloud Run, Using WebSockets: https://docs.cloud.google.com/run/docs/triggering/websockets (fetch failed; content corroborated via secondary sources below)
- Google Cloud Run, Request timeout: https://docs.cloud.google.com/run/docs/configuring/request-timeout
- Google Cloud Run, Session affinity: https://docs.cloud.google.com/run/docs/configuring/session-affinity

Ecosystem / community sources (web search):

- ClickHouse engineering, How to architect multi-tenant SaaS on Postgres: https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture
- PlanetScale, Approaches to tenancy in Postgres: https://planetscale.com/blog/approaches-to-tenancy-in-postgres
- Multi-Tenant Architecture: Database Per Tenant vs Shared Schema (2026): https://dev.to/young_gao/multi-tenant-architecture-database-per-tenant-vs-shared-schema-1n2e
- Encore, NestJS vs Fastify vs Hono (2026): https://encore.dev/articles/nestjs-vs-fastify-vs-hono
- GitLab database guidelines, Polymorphic associations: https://docs.gitlab.com/ee/development/database/polymorphic_associations.html
- The Likes Table Problem: Why We Went Polymorphic: https://dev.to/sauravdhakal12/the-likes-table-problem-why-we-went-polymorphic-5dk1
- Building a Scalable Notification System: https://medium.com/@a_zeraibi/notification-system-on-scale-2ac248df8b83
- Notification System Architecture: Channels, Fan-Out, and Delivery at Scale: https://codelit.io/blog/notification-system-architecture
- Chat schema design (conversations/participants/messages): https://oneuptime.com/blog/post/2026-03-31-mysql-design-schema-for-chat-application/view
- Multi-Tenant Architecture in Next.js: https://medium.com/@itsamanyadav/multi-tenant-architecture-in-next-js-a-complete-guide-25590c052de0
- Custom Theming for Next.js SaaS: https://www.nextsaaspilot.com/blogs/themes-next
- Supabase video transcoding discussion: https://github.com/orgs/supabase/discussions/18002
- Mux, Works with Supabase: https://supabase.com/partners/mux
- Cloudflare Stream + Supabase upload pipeline: https://kashifaziz.me/blog/cloudflare-stream-supabase-video-pipeline/
- WebSockets on Cloud Run with session affinity (2026-02-17): https://oneuptime.com/blog/post/2026-02-17-websocket-connections-node-js-cloud-run-session-affinity/view
- SaaS entitlements with feature flags (AWS APN): https://aws.amazon.com/blogs/apn/simple-and-flexible-saas-entitlement-management-with-launchdarkly/

Package versions checked on npm (2026-09-11): next 16.3.4, @supabase/supabase-js 2.116.0, @supabase/ssr 0.12.7, @nestjs/core 12.0.1, fastify 5.12.4, hono 4.13.7, drizzle-orm 0.45.2, jose 6.2.12, pg-boss 12.31.0, web-push 3.6.7 (last published 2024-01), serwist 9.5.12, tus-js-client 4.3.1.

---
*Architecture research for: multi-tenant white-label community SaaS (Rede Social)*
*Researched: 2026-09-11*
