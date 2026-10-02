#!/usr/bin/env bash
# Build-output gate for ROADMAP Phase 2 criterion 1 (TENANT-02, plan 02-16, RESEARCH Pattern 11):
# "no authenticated or host-branded route may be prerendered". Every page under (app)/, (auth)/,
# (platform)/, the per-tenant manifest under /m/ and the offline page read cookies or headers per
# request, so they must build as ƒ (dynamic). A route that Next turned static would serve ONE
# tenant's brand (or one member's shell) to every host — the cross-tenant leak this phase exists to
# prevent. Runs after `next build` inside the root `verify` script and in CI (`pnpm check:static-routes`).
#
# What it reads (apps/web/.next after `pnpm --filter @rede-social/web build`):
#   - app-path-routes-manifest.json — every App Router source key → public path;
#   - prerender-manifest.json — `routes` (static HTML emitted at build) and `dynamicRoutes`
#     (parametrised routes with generated params).
# What it enforces:
#   1. both manifests exist — a missing file exits 2 with the path (never a pass by absence);
#   2. every key of REQUIRED_KEYS exists in the routes manifest — a moved or renamed route fails the
#      gate ("route moved or renamed — update REQUIRED_KEYS") instead of silently vanishing from it;
#   3. no public path of a key under a GUARDED prefix appears in `routes` or `dynamicRoutes`;
#   4. every key of `routes` matches ALLOWED_STATIC (`^/_` — Next's internals such as /_global-error —
#      or `^/serwist/`): /serwist/[path] is the ONLY legitimately static app output, because 02-11's
#      `createSerwistRoute` prerenders the service-worker script (/serwist/sw.js + .map) at build;
#   5. no `dynamicRoutes` entry other than /serwist/[path] maps back to a guarded source key.
#
# When it fails: read the printed offenders, find which layout/page stopped reading a request-time
# API (`cookies()`, `headers()`, `connection()`) or gained a `generateStaticParams` / `dynamic =
# 'force-static'`, and restore the per-request read — never add the path to the allow-list. The
# allow-list may only ever gain a `/_`-prefixed internal or a `/serwist/` path.
#
# Note: enabling `cacheComponents` (Next 16 Cache Components / PPR) changes what the prerender
# manifest lists (partially prerendered shells appear as routes); this gate must be revisited then.
#
# Node runs the JSON logic (the only runtime guaranteed on every machine; no jq dependency).
# Exit codes: 0 pass, 1 offenders found, 2 build output missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXT_DIR="${NEXT_DIR:-$ROOT/apps/web/.next}"

for file in prerender-manifest.json app-path-routes-manifest.json; do
  if [ ! -f "$NEXT_DIR/$file" ]; then
    echo "check-static-routes: $NEXT_DIR/$file missing — run 'pnpm --filter @rede-social/web build' first" >&2
    exit 2
  fi
done

node - "$NEXT_DIR" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');

const nextDir = process.argv[2];
const prerender = JSON.parse(fs.readFileSync(path.join(nextDir, 'prerender-manifest.json'), 'utf8'));
const appRoutes = JSON.parse(fs.readFileSync(path.join(nextDir, 'app-path-routes-manifest.json'), 'utf8'));

/** Source keys that MUST exist (Phase 2 tree). Extend when a new authenticated route ships. */
const REQUIRED_KEYS = [
  '/(app)/inicio/page',
  '/(app)/configuracoes/page',
  '/(app)/perfil/page',
  // Phase 4: the feed's own routes. `/post/[postId]` is the FEED-07 share target and is therefore
  // effectively permanent; the composer and its edit twin read the session and the host per request.
  '/(app)/post/[postId]/page',
  '/(app)/criar/page',
  '/(app)/post/[postId]/editar/page',
  // Phase 5: the communities tab and one community's page — the destination every D-71 label in
  // the feed points at, and therefore effectively permanent. Both read the session and the host per
  // request, so neither may ever be prerendered.
  '/(app)/comunidades/page',
  '/(app)/comunidades/[communityId]/page',
  '/(app)/comunidades/nova/page',
  '/(app)/comunidades/[communityId]/editar/page',
  // Phase 5: the story routes. The publish screen and the history list read the session per
  // request, and the viewer route is the deep-link target a share or a notification lands on, so
  // all three are authenticated surfaces that may never be prerendered.
  '/(app)/stories/publicar/page',
  '/(app)/stories/meus/page',
  '/(app)/stories/[storyId]/page',
  // Phase 05.2: the two highlight manage screens (D-109, UI-D-72). Both are manage-gated per request
  // (a caller without `stories.story.manage` gets the not-found screen) and read the session, so
  // neither may ever be prerendered. `/stories/destaques` is a LITERAL segment beside
  // `/stories/[storyId]`, and must resolve to its own page, never to the deep link (Pitfall 7).
  '/(app)/stories/destaques/page',
  '/(app)/comunidades/[communityId]/destaques/page',
  // Phase 6: the Eventos tab. It reads the session, the tenant's timezone and the request instant
  // per request (relative labels such as "Hoje" and "Agora"), so it may never be prerendered.
  '/(app)/eventos/page',
  // 06-03: one event's detail. It reads the session, the viewer's own attendance and the request
  // instant (the hero countdown, the phase), so it may never be prerendered either.
  '/(app)/eventos/[eventId]/page',
  // 07-01: the bell's destination. It reads the session and the request instant (relative times)
  // per request, and its server render must never be a cached copy of another member's rows.
  '/(app)/notificacoes/page',
  // Phase 8 (08-01): the tenant admin panel's Moderação screen. It reads the session and the
  // permission per request, so it may never be prerendered.
  '/(app)/configuracoes/moderacao/page',
  // 08-04: the Membros admin list reads the session and the permissions per request.
  '/(app)/configuracoes/membros/page',
  // 07-09: the member's support thread (CHAT-02). It reads the session, the member's own
  // conversation and the request instant (day labels such as "Hoje"), so it may never be prerendered.
  '/(app)/suporte/page',
  // 07-10: the staff side of one member's conversation (CHAT-03). It reads the session, the caller's
  // `chat.support` permission and another member's messages per request, so a prerendered copy would
  // serve one member's thread to every visitor.
  '/(app)/suporte/[conversationId]/page',
  // 06-04: the admin's form routes. Both read the session and the composed manage permission per
  // request (and the edit route the manage-only edit read), so neither may be prerendered.
  '/(app)/eventos/novo/page',
  '/(app)/eventos/[eventId]/editar/page',
  // 06-05: the in-person check-in ticket. It reads the session, the viewer's own attendance and the
  // request instant (open, not open yet, closed), so it may never be prerendered.
  '/(app)/eventos/[eventId]/check-in/page',
  // 06-06: the online `Entrar`. The route handler calls the enter gate per request (a side effect
  // inside the window) and the aviso page reads its `motivo`; neither may ever be prerendered.
  '/(app)/eventos/[eventId]/entrar/route',
  '/(app)/eventos/[eventId]/entrar/aviso/page',
  // 06-07: the organiser's Participantes screen (D-215). It is permission-gated per request and
  // shows the door code, so it may never be prerendered.
  '/(app)/eventos/[eventId]/participantes/page',
  // 06-08: the calendar export. It reads the member's own event through the member lane per request
  // (the session decides which tenant's event it may serialise), so it may never be prerendered.
  '/(app)/eventos/[eventId]/agenda.ics/route',
  '/(auth)/entrar/page',
  '/(platform)/plataforma/page',
  '/(platform)/plataforma/novo/page',
  '/(platform)/plataforma/tenants/[id]/marca/page',
  '/(platform)/plataforma/tenants/[id]/modulos/page',
  '/(platform)/plataforma/tenants/[id]/dominios/page',
  '/(platform)/plataforma/tenants/[id]/admins/page',
  '/(platform)/plataforma/tenants/[id]/status/page',
  '/m/[slug]/manifest.webmanifest/route',
  '/~offline/page',
  '/serwist/[path]/route',
];
/** Source-key prefixes whose public paths may never be static. */
const GUARDED_PREFIXES = ['/(app)/', '/(auth)/', '/(platform)/', '/m/', '/~offline'];
/** The only static output Next may emit: its internals and 02-11's service-worker route. */
const ALLOWED_STATIC = [/^\/_/, /^\/serwist\//];
const STATIC_DYNAMIC_ROUTE = '/serwist/[path]';

const staticRoutes = Object.keys(prerender.routes ?? {});
const dynamicRoutes = Object.keys(prerender.dynamicRoutes ?? {});
const offenders = [];

for (const key of REQUIRED_KEYS) {
  if (!(key in appRoutes)) {
    offenders.push(`${key}: route moved or renamed — update REQUIRED_KEYS`);
  }
}

const guarded = Object.entries(appRoutes).filter(([key]) =>
  GUARDED_PREFIXES.some((prefix) => key.startsWith(prefix)),
);
for (const [key, publicPath] of guarded) {
  if (publicPath in (prerender.routes ?? {})) {
    offenders.push(`${publicPath} (${key}) is prerendered as a static route`);
  }
  if (publicPath in (prerender.dynamicRoutes ?? {})) {
    offenders.push(`${publicPath} (${key}) is listed under dynamicRoutes (prerendered params)`);
  }
}

for (const route of staticRoutes) {
  if (!ALLOWED_STATIC.some((re) => re.test(route))) {
    offenders.push(`${route} is static but not allow-listed (only /_* and /serwist/* may be)`);
  }
}

const guardedPublicPaths = new Map(guarded.map(([key, publicPath]) => [publicPath, key]));
for (const route of dynamicRoutes) {
  if (route === STATIC_DYNAMIC_ROUTE) continue;
  const source = guardedPublicPaths.get(route);
  if (source) offenders.push(`${route} (${source}) is a prerendered dynamic route`);
}

console.log('check-static-routes');
console.log(`  static routes:       ${staticRoutes.length ? staticRoutes.join(', ') : '(none)'}`);
console.log(`  dynamic prerendered: ${dynamicRoutes.length ? dynamicRoutes.join(', ') : '(none)'}`);
console.log(`  guarded routes checked: ${guarded.length}`);
console.log(`  offenders: ${offenders.length}`);
for (const offender of offenders) console.log(`    - ${offender}`);
if (offenders.length > 0) {
  console.error('check-static-routes: FAIL — an authenticated or host-branded route is static');
  process.exit(1);
}
console.log('check-static-routes: OK — no authenticated or host-branded route is static');
EOF
