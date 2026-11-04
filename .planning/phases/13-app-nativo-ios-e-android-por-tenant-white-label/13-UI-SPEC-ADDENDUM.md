---
phase: "13"
slug: "app-nativo-ios-e-android-por-tenant-white-label"
status: draft
created: "2026-11-04"
amends: "13-UI-SPEC.md"
---

# Phase 13 — UI Design Contract, Addendum (D-616..D-619)

> Written by the planner on 2026-11-04. `13-UI-SPEC.md` was approved before Igor decided D-616..D-619. This addendum is the UI contract for what those four decisions add or change. It is NOT approved by the UI checker and NOT approved by Igor: it carries planner-proposed defaults (AD-1..AD-8 below) that the sketch plan (13-01) draws and Igor confirms or overturns when he approves sketch 017. Where this file and `13-UI-SPEC.md` disagree, this file wins for the surfaces named here. Everything else in the UI-SPEC stands.

Continues the UI-D numbering after UI-D-631. Vocabulary rules of the UI-SPEC apply (no bare "loja", never "deletar", "build", "token" on a screen). All text is pt-BR from the catalogs; none in TSX or native source.

## What changes in the approved UI-SPEC

| UI-SPEC item | Change | Reason |
|---|---|---|
| UI-D-625 (both purchase switches "on by default") | Both switches start OFF. Turning a switch OFF needs no dialog (the safe direction). Turning a switch ON opens a `ConfirmDialog` (UI-D-641). The "Esconder compra" dialog of UI-D-625 is dropped. | D-617 |
| UI-D-612 (Início renders saved posts through the web components) | The saved feed is drawn by the SHELL as a native read-only list under a native banner (UI-D-639). The web has no offline-feed rendering and no `aria-disabled` write controls for it. The frames `feed-salvo-faixa`, `feed-salvo-acao-desligada`, `feed-sem-copia` become native frames (`feed-salvo-acao-desligada` is replaced by `feed-salvo-toque`). | D-618 |
| UI-D-627 checklist, row "App enviado para revisão" | Unchanged. The command never submits for review; the tenant does (Apple 4.2.6). One more line in "Como gerar o app": step 3 names TestFlight and Google internal testing as where the command stops. | D-619 |
| `Copywriting Contract` "Purchase" row | "Mostrar compra no iPhone" / "Mostrar compra no Android" stay; helpers are re-worded in UI-D-641. | D-617 |

## New visual decisions (UI-D-632..UI-D-641)

### Report and block (D-616), web, browser and app, for every signed-in role

| # | Question | Decision |
|---|----------|----------|
| **UI-D-632** | Entry points. | `PostMenu` gains a row **"Denunciar publicação"** (`Flag` 20) and, when the author is a `member` and not the viewer, **"Bloquear {nome}"** (`Ban` 20), both below the shipped rows and above "Excluir publicação" (the destructive row stays last). `CommentItem`: the single delete control becomes an `IconButton` `Ellipsis` 20 (aria-label "Mais ações do comentário") that opens the same `BottomSheet` geometry with **"Denunciar comentário"** (`Flag`), **"Bloquear {nome}"** (`Ban`, member authors only) and, for the comment's author or a holder of `moderation.manage`, the existing **delete** row (destructive, last). A viewer never sees "Denunciar" or "Bloquear" on their own content. `canReport` and `canBlock` ride each item from the API as data (never a role comparison), exactly as `canManage` does. Staff accounts (`admin_tenant`, `support_tenant`) can be reported but cannot be blocked by a member (AD-1). |
| **UI-D-633** | The report sheet. | `BottomSheet`, title **"Denunciar publicação"** or **"Denunciar comentário"**, body 14/400 secondary "Diga o que há de errado. A equipe de {tenant} vai analisar.", a radio list (five rows, 48px, the shipped radio-row geometry): **"Conteúdo ofensivo ou de ódio"**, **"Assédio ou bullying"**, **"Spam ou propaganda"**, **"Conteúdo sexual ou violento"**, **"Outro motivo"**; a `Textarea` (optional, 500 characters, counter 12/400 tertiary) labelled **"Quer dar mais detalhes? (opcional)"**; footer brand `Button fullWidth size="lg"` **"Enviar denúncia"** (disabled until a reason is chosen; pending "Enviando…", fields locked, sheet not closable). Success: closes, toast **"Denúncia enviada. Obrigado por avisar."**. Already reported by this viewer: the sheet closes with the toast **"Você já denunciou isto."**. Failure: `role="alert"` block (09.4 geometry) **"Não foi possível enviar agora. Nada foi alterado. Tente de novo."**. The author is never told; nothing on screen implies they will be. |
| **UI-D-634** | Blocking a member. | `ConfirmDialog` (`tone="danger"`, icon `Ban`): title **"Bloquear {nome}?"**, body **"Você deixa de ver as publicações e os comentários de {nome}. {nome} não é avisado. Você pode desbloquear em Configurações."**, confirm **"Bloquear"**, cancel **"Cancelar"**. Success toast **"{nome} foi bloqueado."**; the blocked member's posts and comments disappear from the viewer's lists at once (no placeholder row; AD-2). Failure toast: the shipped "Algo deu errado. Tente novamente.". |
| **UI-D-635** | The blocked list and unblocking. | In `/configuracoes` > Conta, directly under "Editar perfil" and above "Excluir minha conta" (UI-D-616): a `Row` with icon `Ban` 20, label **"Membros bloqueados"**, chevron, to `/configuracoes/bloqueados` (hidden on the platform host). Page: `PageHeader` title **"Membros bloqueados"**, `backHref="/configuracoes"`, a list of rows (avatar 40, name 14/700, outline `Button size="sm"` **"Desbloquear"**; pending "Desbloqueando…"); no confirmation dialog on unblock; toast **"{nome} foi desbloqueado."**. Empty: shipped `EmptyState`, title **"Você não bloqueou ninguém"**, body **"Quando você bloquear alguém, a pessoa aparece aqui para você desbloquear."** Keyset paging like every list. |
| **UI-D-636** | What a blocker sees. | The blocked member's posts and comments are absent from Início, Explorar, the communities feed, comment lists and the post pages (a direct link to a blocked author's post renders the shipped "não encontrado" state). Counters (likes, comments) are NOT recomputed per viewer; a comment count may include hidden comments (AD-3, an accepted limit of the minimum slice). The blocked member sees nothing different. |
| **UI-D-637** | The admin reports list. | `/configuracoes/denuncias`, `notFound()` without `moderation.manage` and on the platform host (the moderation-log rule). A `Row` in Configurações > Moderação, label **"Denúncias"** (`Flag` 20), next to the existing log row. Page: `PageHeader` **"Denúncias"**, filter chips **"Abertas"** (default) · **"Resolvidas"** · **"Todas"** (the `?estado=` param parsed by a closed list, like `?acao=`), keyset paging via `InfiniteScroll`. A row (`Card`, `flex flex-col gap-2`): a `StatusPill` (**"Publicação"** / **"Comentário"**), the state pill (**"Aberta"** neutral, **"Ignorada"** neutral, **"Conteúdo removido"** success, **"Autor bloqueado"** success), 14/400 excerpt of the reported text (120 characters, `line-clamp-3`, `break-words`; "Conteúdo não está mais disponível" when the item no longer exists), 12/400 tertiary line "Motivo: {motivo} · por {nome} · {data}" and the author's name; an outline `Button size="sm"` **"Resolver"** on open items. Empty: `EmptyState` **"Nenhuma denúncia por aqui"** / **"Quando um membro denunciar uma publicação ou um comentário, ele aparece aqui."** |
| **UI-D-638** | Acting on a report. | "Resolver" opens a `BottomSheet` **"Resolver denúncia"** with three rows: **"Ignorar denúncia"** (`Check`), **"Remover conteúdo"** (`Trash2`, danger ink) and **"Bloquear autor"** (`Ban`, danger ink; only when the author is a `member`). "Remover conteúdo" and "Bloquear autor" each open a `ConfirmDialog` (danger tone; remove: **"Remover este conteúdo?"** / **"O conteúdo some para todos. A ação fica registrada no histórico de moderação."** / **"Remover"** / **"Cancelar"**; block: the shipped admin-block dialog and optional reason of Phase 8). Removal goes through the existing comment/post removal paths and their moderation-log rows; blocking the author goes through the existing admin block. Success toast **"Denúncia resolvida."**. Another admin resolving first: the row refreshes with the resolved state and a toast **"Esta denúncia já foi resolvida."** |

### Offline feed, native (D-618)

| # | Question | Decision |
|---|----------|----------|
| **UI-D-639** | The native saved feed. | Native, full screen, over nothing (the web view is not rendered): a native banner under the status bar, `role="status"`, 12/400, `bg-bg-tertiary`: **"Sem internet. Você está vendo o que foi salvo {when}."** (`{when}` as UI-D-612). Below, a scrolling list of read-only cards (white card, 12 radius, `p-4`, gap 12): avatar 40 (cached image or the neutral disc), author name 14/700, time 12/400 tertiary, text 14/400 up to 6 lines, one media tile 16:9 (cached thumbnail or the neutral `bg-bg-tertiary` tile with `ImageOff`/`Play` glyph; no broken-image icon), and a plain text counts line 12/400 tertiary ("{n} curtidas · {m} comentários") with NO buttons. Tapping a card shows the native toast **"Sem internet. Tente de novo quando a conexão voltar."** (AD-4). Pull to refresh retries the web load. When the connection returns the shell reloads the web view and the list is removed. Text follows the system font scale to 130%; 48dp targets do not apply because nothing is a control. No saved copy: UI-D-611. |
| **UI-D-640** | What the page hands over. | Nothing on screen: after each successful Início load the page sends the snapshot over the bridge (`snapshot.feed`, bounded by the contract); nothing is shown or toasted. Logout and a different member's sign-in erase it (UI-D-609 rules for the lock apply the same way). |

### Purchase default off (D-617)

| # | Question | Decision |
|---|----------|----------|
| **UI-D-641** | The "Compra no app" card with both switches off. | Intro unchanged. Helper under each switch by state: **off** (default) "O app esconde preço, botão e link. Quem já tem acesso continua vendo o conteúdo."; **on** "O app mostra preços, o botão de compra e o link para o navegador." **Turning ON** opens a `ConfirmDialog` (brand tone, icon `Unlock`): **"Mostrar a compra no iPhone?"** (Android: **"Mostrar a compra no Android?"**) / **"Quem ainda não tem acesso passa a ver preço e botão de compra no app. As lojas de apps costumam recusar apps que levam a compra para fora delas. Ligue só onde a loja já liberou esse tipo de compra."** / confirm **"Mostrar compra"** / cancel **"Manter escondida"**. Turning OFF has no dialog; both directions toast the shipped saved/error toasts. The effect on installed apps is immediate (PU-5). The "Passo a passo" copy does not mention purchase. |

## Planner assumptions to confirm at the sketch review (AD-1..AD-8)

| # | Assumption | If Igor overturns it |
|---|---|---|
| AD-1 | A member can block only a `member`, never `admin_tenant` or `support_tenant` (they are the tenant's voice and the support channel); staff can still be reported. | Allowing staff blocks lets a member hide official posts and support replies; the schema would not change. |
| AD-2 | A blocked member's content disappears without a placeholder. | A "Conteúdo de membro bloqueado" placeholder adds one row component per list. |
| AD-3 | Comment and like counters are not recomputed per viewer. | Per-viewer counts need a join in every list query; out of the minimum slice. |
| AD-4 | A tap on a card in the native saved feed toasts the offline sentence and opens nothing. | Opening the post needs the page, which is offline: nothing else is possible. |
| AD-5 | The report reasons are the five listed, fixed with the table CHECK (append-only later). | A free-text-only report is simpler but gives the admin nothing to filter by. |
| AD-6 | A report is per (reporter, subject): a second report of the same item by the same member is refused with "Você já denunciou isto." and different members' reports of one item are separate rows. | Grouping rows per item adds a count column and a different list query. |
| AD-7 | Reports of a post or comment the viewer wrote, of deleted items and of another tenant's items are refused. | none |
| AD-8 | The report and block surfaces are available in the browser and the app alike and with the `social` module on or off (the minimum slice is a kernel capability, not part of `social`). | Gating by `social` would leave V1 comments without a report path in the stores' review. |

## UI Considerations (planner-authored for UI-D-632..641; same lift rule as the UI-SPEC section)

Element inventory: **E18** report sheet and block dialog · **E19** blocked list · **E20** admin reports list and resolve sheet · **E21** native saved feed · **E22** purchase switch ON dialog.

| Category | Element(s) | Status | Resolution |
|---|---|---|---|
| empty | E18 | covered | No reason chosen: the send button is disabled (UI-D-633) |
| loading | E18 | covered | "Enviando…", fields locked, sheet not closable (UI-D-633) |
| error | E18 | covered | Failure alert, already-reported toast (UI-D-633) |
| long-text | E18 | backstop | A 40-character member name wraps in the block dialog and the row label at 320px; a visual UI-state test |
| empty | E19 | covered | Shipped empty state "Você não bloqueou ninguém" (UI-D-635) |
| loading | E19 | covered | "Desbloqueando…" on the row button (UI-D-635) |
| error | E19 | covered | Shipped error toast, the row stays (UI-D-635) |
| overflow | E19 | covered | Keyset paging, 20 per page (UI-D-635) |
| long-text | E19 | covered | Name truncates in the row, `break-words` in the dialog (UI-D-635) |
| empty | E20 | covered | "Nenhuma denúncia por aqui" per filter (UI-D-637) |
| loading | E20 | covered | `loading.tsx` skeleton rows; "Resolver" pending state (UI-D-637, UI-D-638) |
| error | E20 | covered | `error.tsx` shipped card; resolved-by-another-admin toast (UI-D-638) |
| partial | E20 | covered | Deleted item reads "Conteúdo não está mais disponível" (UI-D-637) |
| overflow | E20 | covered | Excerpt clamped to 3 lines and 120 characters (UI-D-637) |
| long-text | E20 | backstop | A 500-character note and a long author name do not push the state pill out at 320px; a visual UI-state test |
| empty | E21 | covered | No saved copy: the load-failure screen (UI-D-639) |
| populated | E21 | covered | Banner, cards, counts line (UI-D-639) |
| partial | E21 | covered | Missing media renders the neutral tile (UI-D-639) |
| overflow | E21 | covered | At most 20 saved posts, scrolls natively (UI-D-639) |
| zero-one-many | E21 | covered | One saved post renders the same list and banner (UI-D-639) |
| long-text | E21 | backstop | A long post and a long author name wrap at 320dp and 130% font scale without clipping the counts line; a visual UI-state test |
| error | E22 | covered | Failed write: the shipped toast and the switch returns (UI-D-641) |
| loading | E22 | covered | The shipped `Switch` `busy` while the write runs (UI-D-641) |
