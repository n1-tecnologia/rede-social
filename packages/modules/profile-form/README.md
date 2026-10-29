# @rede-social/module-profile-form

The tenant's profile form (Phase 12, PFORM-01..): the admin builds the questions members answer to
complete their profile, reads and exports the answers, and the required questions hold a member out of
the app until they are answered. With the module off for a tenant nothing changes for anyone: the gate
fact is 0 and the builder is hidden (D-589). It is off by default for every tenant and no existing
tenant gets a row (D-596); turning it on is the platform super_admin's explicit per-tenant act.

**This package holds no tables and no jobs of its own.** The tables, the gate and the member routes are
KERNEL code, because `requireAuth` reads the gate on every request (the D-501 split, as in payments).
This first slice (plan 12-02) is the manifest and the permission names only; the admin routes and the
export arrive in plans 08 to 10.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `profileFormModule`, the manifest |
| `./contracts` | the permission names `PROFILE_FORM_PERMISSIONS` (`profile_form.manage`, `profile_form.read`) |

`profile_form.manage` is composed for `admin_tenant` only, by construction; `profile_form.read` is
composed for `admin_tenant` and `support_tenant`. A `member` never gets either.

## Events emitted

None.

## Events consumed

- Manifest subscriptions: none.
- Notification sources: none.
- Notification retractions: none.

## Flag key

`profile_form` in `tenant_modules`. No `requires`: the form works whatever other module is on. Off by
default: not in `REAL_TENANT_DEFAULT_MODULES`, and the migration that widened the CHECK inserted no row,
so a missing row reads as disabled.

## Kernel dependencies

- `@rede-social/core/server/modules/manifest`

## Navigation

- None. The module has no shell entry: its door is a row of Configurações.

## Jobs

- None.

## Reuse

The worked example of mounting a module lives in `packages/reuse-fixture` (it mounts the events
module; this module mounts the same way). A host app must provide the kernel tables and functions of
Phase 12 once they exist, a request id and a per-request logger.
