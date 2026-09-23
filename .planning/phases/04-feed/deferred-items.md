# Phase 04 — deferred items

Out-of-scope discoveries logged rather than fixed (executor scope-boundary rule: only issues
DIRECTLY caused by the current task's changes are auto-fixed).

## From 04-04

### 1. ~~`apps/web/e2e/shell.spec.ts:111` contradicts `feed.spec.ts`~~ — FIXED in 04-06 (WINDOWS 22 closed)

`shell.spec.ts` › "tria-lab: no Exemplo tab, no #exemplo, the 'Em breve' card, the lab brand"
expects `HomeSlots`' "Em breve" placeholder on tria-lab's `/inicio`. Since 04-01 the lab tenant has
the `feed` module enabled (`scripts/seed.ts`: `modules: ['feed', 'events']`), so the feed home slot
renders real cards and the placeholder is correctly absent — which is exactly what `feed.spec.ts` ›
"a tria-lab member never sees the tria-demo feed" asserts in the opposite direction.

Fails deterministically on a fresh `db:reset && db:seed`, at HEAD and before 04-04's commits.
Nothing in 04-04's diff touches the shell, the registry's module list or the lab tenant's flags.

**FIXED by 04-06** (commit `dd0987f`). The assertion was re-aimed at the feed widget: the lab case
now asserts that the registered slot rendered (`region[aria-label="Publicações da comunidade"]`
inside `main.app-scroll`) and that the "Em breve" placeholder is ABSENT, which is UI-D-20's actual
rule. A second, unreported half of the same test also had to be fixed: the page-wide
`getByRole('link', { name: 'Exemplo' })` check matched 04-05's auto-linked
`https://…exemplo.invalid/…` captions (Playwright's `name` is a case-insensitive SUBSTRING match by
default), so it is now scoped to the nav tree with `exact: true`. `shell.spec.ts` is green on both
projects.

### 2. `apps/web/e2e/platform-branding.spec.ts:182` is order-dependent

"1. preview follows the form; low contrast warns; confirmation saves; the tenant host reflects the
new primary" fails inside a full `pnpm e2e` run (a `Baixo …` contrast warning is still on screen
where the spec expects none) and PASSES when the file is run on its own against a fresh seed. A
prior spec leaves the tenant on a low-contrast primary. Phase 2 territory; untouched by 04-04.

### 3. `apps/api/tests/integration/media.test.ts` still sweeps the whole `media` bucket prefix

`removeTenantMediaObjects` deletes every Storage object under `<tenant>/media/`, including the
objects behind 04-04's seeded gallery posts. 04-04 narrowed the `media_assets` row deletes so the
foreign key holds and the rows survive, but the BYTES do not: after the API suite runs, the seeded
gallery renders `MediaImage`'s neutral box until the next `pnpm db:seed`. No assertion depends on
the pixels, so this is cosmetic drift in the local fixture rather than a product defect.

### 4. `apps/web/e2e/feed.spec.ts` flakes under repeated runs against the shared local stack

Observed while verifying 04-07: `playwright test feed.spec.ts --repeat-each=3` (that file ALONE,
with no 04-07 spec in the run) fails 10 of 69 — different tests on different passes, all of them
timing assertions on a server-action round trip (`a failed like reverts…`, `the sentinel appends one
page…`). A single pass of the same file is green, and so is a single pass of every feed spec
together. The cause is the local `next dev` server under sustained load, not the feature: none of
the failures is reproducible in isolation and none of them names a wrong VALUE, only a value that
had not arrived yet.

Out of scope for 04-07 (the scope-boundary rule: this file was not touched by this plan). If CI ever
runs the e2e suite with repeats or higher parallelism, the fix is to give these round-trip
assertions an explicit longer timeout rather than to relax what they assert.
