## Deferred Items

- The Início manage-screen e2e walk is intermittent on `mobile-chromium` (05.2-09 code path)
  status: open
  **Found during:** 05.2-10 Task 3 (running `stories.spec.ts` on the :3100 production build).
  **What:** `stories.spec.ts` › "the Início manage screen" › "create, rename, add the EXPIRED story, pick it as cover, remove it, move up by keyboard, delete" failed once in the full-file run and once in 3 isolated re-runs (2 of 3 passed). It times out on "Salvar nome": Playwright reports the edit sheet "not stable" while it animates in, then the button stays disabled after `fill`. The likely cause is that the highlight's edit read lands after the fill and resets the draft name to the server title, so the name is "unchanged" again.
  **Why deferred:** 05.2-10 changes none of the manage-screen files (`HighlightManager.tsx`, `HighlightEditSheet.tsx`, `/stories/destaques`); `git diff b3f19b9` over them is empty. It is out of 05.2-10's scope under the scope-boundary rule.
  **Suggested fix:** in the spec, wait for the sheet's heading to be focused (or for the edit read to settle) before `fill`. Alternatively, make `HighlightEditSheet` keep a user-edited draft when a re-read arrives with the same title.
