---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 0
total_count: 7
last_updated: 2026-09-12T21:34:49.618Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 01 | stub | apps/api/src/routes/me.ts |  | bootstrap returns modules: [] and permissions: [] until plan 01-06 fills them from tenant_modules | open |  | 2026-09-12T11:47:31.307Z |  |
| 2 | 01 | stub | apps/api/src/routes/me.ts |  | bootstrap counters are zero until Phase 7 (notifications/chat) | open |  | 2026-09-12T11:47:31.375Z |  |
| 3 | 01 | stub | apps/web/app/(auth)/entrar/page.tsx |  | Generic-host tenant hint waits for GET /v1/public/tenants/{slug} (plan 01-04); link shown, hint absent until then | open |  | 2026-09-12T13:28:27.502Z |  |
| 4 | 01 | stub | apps/web/app/(app)/layout.tsx |  | Only 401 handled in the bootstrap catch; 403 codes (MEMBERSHIP_BLOCKED/NO_MEMBERSHIP/TENANT_HOST_MISMATCH) rethrow until plan 01-05 | open |  | 2026-09-12T13:28:27.571Z |  |
| 5 | 01 | stub | packages/core/db/schema/chat-stubs.ts |  | Chat stub tables have no triggers, Realtime wiring or routes — intentional shape-only Foundation deliverable, resolved by Phase 7 | open |  | 2026-09-12T21:16:10.084Z |  |
| 6 | 01 | stub | packages/core/db/schema/notification-stubs.ts |  | notifications stub has no producer or fan-out worker — resolved by Phase 7 | open |  | 2026-09-12T21:16:10.151Z |  |
| 7 | 01 | unrun-verify | .github/workflows/ci.yml |  | ci.yml runs pnpm boundaries:negative (scripts/check-boundaries.sh) and supabase test db (supabase/tests/) which do not exist yet; both are owed by sibling plans in phase 01 | open |  | 2026-09-12T21:34:49.618Z |  |

````json
[
  {
    "id": 1,
    "kind": "stub",
    "phase": "01",
    "file": "apps/api/src/routes/me.ts",
    "line": null,
    "description": "bootstrap returns modules: [] and permissions: [] until plan 01-06 fills them from tenant_modules",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-12T11:47:31.307Z",
    "resolved_at": null
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
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-12T13:28:27.502Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "stub",
    "phase": "01",
    "file": "apps/web/app/(app)/layout.tsx",
    "line": null,
    "description": "Only 401 handled in the bootstrap catch; 403 codes (MEMBERSHIP_BLOCKED/NO_MEMBERSHIP/TENANT_HOST_MISMATCH) rethrow until plan 01-05",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-12T13:28:27.571Z",
    "resolved_at": null
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
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-12T21:34:49.618Z",
    "resolved_at": null
  }
]
````
