# Phase 04 — deferred items

Out-of-scope discoveries logged rather than fixed (executor scope-boundary rule: only issues
DIRECTLY caused by the current task's changes are auto-fixed).

## From 04-04

### 1. `apps/web/e2e/shell.spec.ts:111` contradicts `feed.spec.ts` — pre-existing since 04-01

`shell.spec.ts` › "tria-lab: no Exemplo tab, no #exemplo, the 'Em breve' card, the lab brand"
expects `HomeSlots`' "Em breve" placeholder on tria-lab's `/inicio`. Since 04-01 the lab tenant has
the `feed` module enabled (`scripts/seed.ts`: `modules: ['feed', 'events']`), so the feed home slot
renders real cards and the placeholder is correctly absent — which is exactly what `feed.spec.ts` ›
"a tria-lab member never sees the tria-demo feed" asserts in the opposite direction.

Fails deterministically on a fresh `db:reset && db:seed`, at HEAD and before 04-04's commits.
Nothing in 04-04's diff touches the shell, the registry's module list or the lab tenant's flags.

**Fix belongs to:** whichever plan next owns `shell.spec.ts` (04-06 wires `FeedList` into the page
and is the natural home). The spec needs a tenant with an enabled module that contributes NO home
slot, or the assertion re-aimed at the feed widget.

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
