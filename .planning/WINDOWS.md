---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 6
total_count: 13
last_updated: 2026-09-22T02:20:08.948Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | apps/api/src/routes/me.ts |  | bootstrap returns modules: [] and permissions: [] until plan 01-06 fills them from tenant_modules | fixed |  | 2026-09-12T11:47:31.307Z | 2026-09-13T14:52:43.788Z |
| 2 | 01 | stub | apps/api/src/routes/me.ts |  | bootstrap counters are zero until Phase 7 (notifications/chat) | open |  | 2026-09-12T11:47:31.375Z |  |
| 3 | 01 | stub | apps/web/app/(auth)/entrar/page.tsx |  | Generic-host tenant hint waits for GET /v1/public/tenants/{slug} (plan 01-04); link shown, hint absent until then | fixed |  | 2026-09-12T13:28:27.502Z | 2026-09-13T14:03:19.772Z |
| 4 | 01 | stub | apps/web/app/(app)/layout.tsx |  | Only 401 handled in the bootstrap catch; 403 codes (MEMBERSHIP_BLOCKED/NO_MEMBERSHIP/TENANT_HOST_MISMATCH) rethrow until plan 01-05 | fixed |  | 2026-09-12T13:28:27.571Z | 2026-09-13T14:24:42.696Z |
| 5 | 01 | stub | packages/core/db/schema/chat-stubs.ts |  | Chat stub tables have no triggers, Realtime wiring or routes — intentional shape-only Foundation deliverable, resolved by Phase 7 | open |  | 2026-09-12T21:16:10.084Z |  |
| 6 | 01 | stub | packages/core/db/schema/notification-stubs.ts |  | notifications stub has no producer or fan-out worker — resolved by Phase 7 | open |  | 2026-09-12T21:16:10.151Z |  |
| 7 | 01 | unrun-verify | .github/workflows/ci.yml |  | ci.yml runs pnpm boundaries:negative (scripts/check-boundaries.sh) and supabase test db (supabase/tests/) which do not exist yet; both are owed by sibling plans in phase 01 | fixed |  | 2026-09-12T21:34:49.618Z | 2026-09-13T16:00:54.291Z |
| 8 | 01 | stub | apps/api/src/modules/registry.ts |  | MODULE_REGISTRY is empty until 01-07 registers @tria/module-example: bootstrap entries carry no nav, so /inicio lists raw module keys instead of labels | fixed |  | 2026-09-13T14:52:56.229Z | 2026-09-13T16:00:54.360Z |
| 9 | 01 | stub | packages/modules/example/module.ts |  | throwaway reference module @tria/module-example (D-19) — must be deleted with its table and registry entry in Phase 4 | open |  | 2026-09-13T15:21:32.750Z |  |
| 10 | 02 | stub | apps/web/app/(app)/configuracoes/page.tsx |  | Settings rows 'Editar perfil' and 'Notificações' are static placeholders with an 'Em breve' pill (D-42); Phase 3 wires profile edit, Phase 7 wires push | open |  | 2026-09-16T23:53:19.085Z |  |
| 11 | 03 | deviation | apps/web/app/(app)/perfil/page.tsx |  | The /perfil 'Membros' row points at /membros, which 03-05 lands in the next wave — a known one-wave dead link | fixed |  | 2026-09-22T00:37:02.401Z | 2026-09-22T01:40:51.643Z |
| 12 | 03 | unrun-verify | packages/core/server/media/video/mux.ts |  | The Mux adapter (createDirectUpload, webhooks.unwrap, signPlaybackId, assets.delete) is written and typed but has NEVER run against a real Mux account — no account exists and Phase 01.1 is deferred. Every proof in 03-06 runs against VIDEO_PROVIDER=fake. Closed by the docs/DEPLOY.md Phase 01.1 Mux runbook. | open |  | 2026-09-22T02:20:03.090Z |  |
| 13 | 03 | stub | packages/core/server/media/video/index.ts |  | videoProvider.signPlayback and getAsset are implemented on both adapters but wired to no route yet: 03-07 adds GET /v1/media/{assetId}/playback, and getAsset waits for a future reconciliation job (declared so that job needs no adapter change). | open |  | 2026-09-22T02:20:08.948Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "apps/api/src/routes/me.ts",
    "line": null,
    "description": "bootstrap returns modules: [] and permissions: [] until plan 01-06 fills them from tenant_modules",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T11:47:31.307Z",
    "resolved_at": "2026-09-13T14:52:43.788Z"
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "01",
    "file": "apps/api/src/routes/me.ts",
    "line": null,
    "description": "bootstrap counters are zero until Phase 7 (notifications/chat)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-12T11:47:31.375Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "stub",
    "phase": "01",
    "file": "apps/web/app/(auth)/entrar/page.tsx",
    "line": null,
    "description": "Generic-host tenant hint waits for GET /v1/public/tenants/{slug} (plan 01-04); link shown, hint absent until then",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T13:28:27.502Z",
    "resolved_at": "2026-09-13T14:03:19.772Z"
  },
  {
    "id": 4,
    "kind": "stub",
    "phase": "01",
    "file": "apps/web/app/(app)/layout.tsx",
    "line": null,
    "description": "Only 401 handled in the bootstrap catch; 403 codes (MEMBERSHIP_BLOCKED/NO_MEMBERSHIP/TENANT_HOST_MISMATCH) rethrow until plan 01-05",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T13:28:27.571Z",
    "resolved_at": "2026-09-13T14:24:42.696Z"
  },
  {
    "id": 5,
    "kind": "stub",
    "phase": "01",
    "file": "packages/core/db/schema/chat-stubs.ts",
    "line": null,
    "description": "Chat stub tables have no triggers, Realtime wiring or routes — intentional shape-only Foundation deliverable, resolved by Phase 7",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-12T21:16:10.084Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "stub",
    "phase": "01",
    "file": "packages/core/db/schema/notification-stubs.ts",
    "line": null,
    "description": "notifications stub has no producer or fan-out worker — resolved by Phase 7",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-12T21:16:10.151Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "01",
    "file": ".github/workflows/ci.yml",
    "line": null,
    "description": "ci.yml runs pnpm boundaries:negative (scripts/check-boundaries.sh) and supabase test db (supabase/tests/) which do not exist yet; both are owed by sibling plans in phase 01",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-12T21:34:49.618Z",
    "resolved_at": "2026-09-13T16:00:54.291Z"
  },
  {
    "id": 8,
    "kind": "stub",
    "phase": "01",
    "file": "apps/api/src/modules/registry.ts",
    "line": null,
    "description": "MODULE_REGISTRY is empty until 01-07 registers @tria/module-example: bootstrap entries carry no nav, so /inicio lists raw module keys instead of labels",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-13T14:52:56.229Z",
    "resolved_at": "2026-09-13T16:00:54.360Z"
  },
  {
    "id": 9,
    "kind": "stub",
    "phase": "01",
    "file": "packages/modules/example/module.ts",
    "line": null,
    "description": "throwaway reference module @tria/module-example (D-19) — must be deleted with its table and registry entry in Phase 4",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-13T15:21:32.750Z",
    "resolved_at": null
  },
  {
    "id": 10,
    "kind": "stub",
    "phase": "02",
    "file": "apps/web/app/(app)/configuracoes/page.tsx",
    "line": null,
    "description": "Settings rows 'Editar perfil' and 'Notificações' are static placeholders with an 'Em breve' pill (D-42); Phase 3 wires profile edit, Phase 7 wires push",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-16T23:53:19.085Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "03",
    "file": "apps/web/app/(app)/perfil/page.tsx",
    "line": null,
    "description": "The /perfil 'Membros' row points at /membros, which 03-05 lands in the next wave — a known one-wave dead link",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-22T00:37:02.401Z",
    "resolved_at": "2026-09-22T01:40:51.643Z"
  },
  {
    "id": 12,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "packages/core/server/media/video/mux.ts",
    "line": null,
    "description": "The Mux adapter (createDirectUpload, webhooks.unwrap, signPlaybackId, assets.delete) is written and typed but has NEVER run against a real Mux account — no account exists and Phase 01.1 is deferred. Every proof in 03-06 runs against VIDEO_PROVIDER=fake. Closed by the docs/DEPLOY.md Phase 01.1 Mux runbook.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T02:20:03.090Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "stub",
    "phase": "03",
    "file": "packages/core/server/media/video/index.ts",
    "line": null,
    "description": "videoProvider.signPlayback and getAsset are implemented on both adapters but wired to no route yet: 03-07 adds GET /v1/media/{assetId}/playback, and getAsset waits for a future reconciliation job (declared so that job needs no adapter change).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-22T02:20:08.948Z",
    "resolved_at": null
  }
]
````
