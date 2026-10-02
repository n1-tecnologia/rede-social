---
status: resolved
trigger: "Destaques do início → Editar destaque → Escolher capa: após enviar uma imagem de capa (upload), o app mostra o toast \"Não foi possível salvar. Tente novamente.\" e a capa não é salva."
created: 2026-10-01
updated: 2026-10-01
---

## Symptoms

- expected: an uploaded image becomes the highlight's cover ("Capa atualizada.")
- actual: generic error toast "Não foi possível salvar. Tente novamente."; the cover is not saved
- reproduction: manage highlights → edit a highlight → Alterar capa → upload tile → pick an image

## Resolution

root_cause: `HighlightManager`'s upload `onCompleted` PATCHed `{ cover: { assetId } }` immediately. `POST /v1/media/uploads/:id/complete` answers an image as `processing` (the worker derives variants before flipping it to `ready`), and the stories service accepts only a `ready` cover asset — every other state is the bare 404 → `generic` toast. So the write failed on essentially every upload. The community/event forms never hit this because their cover is saved on form submit, seconds later.

fix: when the completed asset is not yet `ready`, the manager stores `{ highlightId, assetId }` and polls with the existing `useAssetReadiness` hook; on `ready` it writes the cover (only if the same highlight is still being edited), on `failed`/`rejected`/404 it shows the generic toast. The upload tile stays disabled and shows "Processando" while waiting. An already-`ready` asset is written straight away. API contract unchanged.

verification: new tests C1–C3 in `apps/web/components/stories/HighlightManager.test.tsx` (C1 fails against the old code); `components/stories` suite 44/44; `tsc --noEmit` clean; biome clean.

files_changed:
- apps/web/components/stories/HighlightManager.tsx
- apps/web/components/stories/HighlightManager.test.tsx
