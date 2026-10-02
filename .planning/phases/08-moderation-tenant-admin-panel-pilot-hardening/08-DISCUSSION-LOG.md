# Phase 8: Moderation, Tenant Admin Panel & Pilot Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-01
**Phase:** 08-moderation-tenant-admin-panel-pilot-hardening
**Areas discussed:** Blocking & roles, Comment removal & log, Admin panel on mobile, Go-live gate & hardening

---

## Blocking & roles

**What happens to a blocked member's existing comments?**

| Option | Description | Selected |
|--------|-------------|----------|
| Stay visible | Blocking is about access; admin removes comments individually | ✓ |
| Hidden while blocked | Hide everything by a blocked member, restore on unblock | |
| Admin chooses at block time | Checkbox to mass soft-delete their comments | |

**Reason when blocking and who sees it?**

| Option | Description | Selected |
|--------|-------------|----------|
| Optional, internal only | Reason goes only to the moderation log; member sees generic "acesso suspenso" | ✓ |
| Optional, shown to member | Reason on the suspended screen | |
| Required, internal only | Mandatory reason | |

**Who can an admin_tenant block or demote?**

| Option | Description | Selected |
|--------|-------------|----------|
| Anyone except self and the last admin | API guards against self-action and leaving zero active admins | ✓ |
| Members and support only | Only super_admin acts on admins | |
| Anyone, including self | No guards | |

**Blocked member's support thread for staff?**

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only with "Membro bloqueado" tag | Stays in inbox, composer disabled, writable again on unblock | ✓ |
| Hidden from inbox | Disappears while blocked | |
| Unchanged | Staff can still write | |

---

## Comment removal & log

**What replaces a removed comment?**

| Option | Description | Selected |
|--------|-------------|----------|
| Disappears with its replies | Same as author delete today | ✓ |
| Placeholder, replies kept | "Comentário removido pela moderação" | |
| Placeholder, replies removed | One-line tombstone | |

**Notify the author?**

| Option | Description | Selected |
|--------|-------------|----------|
| No notification | Silent, consistent with D-214 | ✓ |
| In-app notification | New notification kind | |

**Which comments are in scope?**

| Option | Description | Selected |
|--------|-------------|----------|
| All: feed, community, story, reel | MODER-01 as written | ✓ |
| Feed and community only | Story comments expire anyway | |

**Moderation log content?**

| Option | Description | Selected |
|--------|-------------|----------|
| Chronological list + removed-text snapshot | Action, actor, target, time, reason, excerpt; filter by action | ✓ |
| Chronological list, no snapshot | MODER-03 minimum | |
| List + per-member history on profile | Extra surface | |

**Can support_tenant remove comments or see the log?**

| Option | Description | Selected |
|--------|-------------|----------|
| No, admin_tenant only | New moderation permission granted to admin_tenant | ✓ |
| Support removes comments, admin-only log | | |

---

## Admin panel on mobile

**Where does the panel live?**

| Option | Description | Selected |
|--------|-------------|----------|
| Grow Configurações → Administração | Rows Marca, Membros, Regras, Moderação beside Mídia, Stories | ✓ |
| Dedicated /admin hub | One row to a hub with cards | |
| Admin tab in BottomNav | Role-dependent nav | |

**In-context vs panel actions?**

| Option | Description | Selected |
|--------|-------------|----------|
| Both | Comment menu Remover, profile admin sheet, plus Membros admin list with status filter | ✓ |
| Panel only | | |
| In context only | Blocked members unreachable | |

**Rules change and existing members?**

| Option | Description | Selected |
|--------|-------------|----------|
| New version for new sign-ups only | Bump rules_version, no re-accept wall | ✓ |
| Existing members must re-accept | Blocking screen in app shell | |
| Admin chooses per edit | | |

**Branding editor vs super_admin's?**

| Option | Description | Selected |
|--------|-------------|----------|
| Same editor, reused | Same fields, last save wins | ✓ |
| Reduced editor | Display name stays super_admin-only | |

**Design gate?**

| Option | Description | Selected |
|--------|-------------|----------|
| UI-SPEC only, no sketch gate | Like 08.1 D-319 | ✓ |
| Full sketch gate | UI-SPEC + /gsd-sketch approval | |
| Sketch only new screens | | |

---

## Go-live gate & hardening

**Gate placement vs 08.1?**

| Option | Description | Selected |
|--------|-------------|----------|
| Split: Phase 8 runs it, 08.1 re-runs as final MVP gate | | ✓ |
| Move whole gate to 08.1 | | |
| Gate in Phase 8 only | | |

**Real-device pass?**

| Option | Description | Selected |
|--------|-------------|----------|
| Production, dedicated qa tenant, one consolidated checklist | Covers all deferred real-device rows | ✓ |
| Production, existing tenant | igor-alves-teste | |
| LAN/tunnel to local stack | | |

**Hardening items in scope (multi-select)?**

| Option | Description | Selected |
|--------|-------------|----------|
| Observability: Sentry + log fields | | |
| Perf: EXPLAIN on 10k seed | | |
| Security: CORS lock + CSP + IN-01..07 | | ✓ |
| Ops: Cloud Run config in git, backup rehearsal, a11y | | |

**MOD-05 proof?**

| Option | Description | Selected |
|--------|-------------|----------|
| READMEs for all modules + automated copy test | CI-runnable reuse fixture | ✓ |
| READMEs + manual walkthrough | | |
| READMEs only | | |

**Inherited test debt (WINDOWS 64, 65, 69-71, e2e:pwa, CI timeout)?**

| Option | Description | Selected |
|--------|-------------|----------|
| Fix inside Phase 8 as gate blockers | One green pnpm verify required | ✓ |
| Separate /gsd-debug before the gate | | |
| Accept as known reds | | |

**LGPD legal review?**

| Option | Description | Selected |
|--------|-------------|----------|
| Checklist row the developer signs off | No code | ✓ |
| Block gate until lawyer reviews | | |
| Drop from gate | | |

---

## Claude's Discretion

- Moderation module shape and atomic log append from feed/stories
- Whether role changes are logged too (recommended)
- Confirm dialogs; no undo for removal
- Invite management placement in the Membros admin list
- Rules editor format (plain text)
- Desktop layout of admin screens
- Isolation suite inventory and i18n audit method
- qa tenant lifecycle after the gate

## Deferred Ideas

- Sentry/log fields, EXPLAIN 10k seed, Cloud Run config in git, backup rehearsal, a11y pass (post-pilot backlog)
- Rules re-acceptance wall
- Author notification on removal
- Hiding/mass-deleting a blocked member's content
- Support moderation permission
- Admin restore of removed comments
