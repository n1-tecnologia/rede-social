# @rede-social/module-reels

The full-screen vertical video tab (REELS-01..08). It owns a manifest, constants and props-only UI,
and nothing else: no server routes, no tables, no jobs. It reads posts only through the feed's
published HTTP contract (`GET /v1/feed?media=video`), so it `requires` the feed module and is
dropped from the bootstrap and the permission set whenever feed is off.

## Contracts

| Subpath | What it holds |
|---|---|
| `./module` | `reelsModule`, the manifest |
| `./contracts` | Constants only (no schemas): paging, gesture and playback tuning |
| `./ui` | `ReelsPager`, `ReelsStage`, `ReelsLanes`, `ReelRail`, `ReelCaption`, `ReelPlaybackError`, `ticksWindow`, `compactCount` |

There is no `./server` and no `./db` export.

Main contract names (`./contracts`): `REELS_PAGE_SIZE`, `REELS_MOUNT_RADIUS`, `REELS_TICK_WINDOW`,
`REELS_PREFETCH_DISTANCE`, `REELS_MINT_MAX_IDS`, `REELS_TOKEN_REMINT_MARGIN_MS`,
`REELS_SWIPE_THRESHOLD_PX`, `REELS_WHEEL_THRESHOLD_PX`, `REELS_BUFFERING_DELAY_MS`,
`REELS_AUTOPLAY_CHECK_MS`, `REELS_COVER_MAX_RATIO`.

## Events emitted

None.

## Events consumed

None.

## Flag key

`reels` in `tenant_modules`, which `requires` `feed`. The registry's `effectiveKeys` drops reels
from the bootstrap and the permission set while feed is off.

## Kernel dependencies

- `@rede-social/core/server/modules/manifest`

## Navigation

- Tab "Reels": placement `tab`, href `/reels`, icon `film`, order 30, chrome `media` (the dark
  full-bleed shell).
- Home slots: none.

## Jobs

- Jobs: none.
- Sweep functions: none.

## Reuse

The worked example lives in `packages/reuse-fixture`, which mounts a module with routes; reels has
none to mount. A host app must provide: the manifest in its registry (so the bootstrap carries the
tab) with `requires` enforced the way `effectiveKeys` does, the feed module or an API answering
`GET /v1/feed?media=video` with the feed's contract, and the web route that renders `ReelsPager`.
