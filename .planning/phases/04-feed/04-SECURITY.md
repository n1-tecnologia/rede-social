---
phase: "04"
slug: "feed"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
threats_total: 66
threats_closed: 66
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-09-23"
verified: "2026-09-23"
residuals_open: 4
unregistered_flags: 2
---

# Phase 04 — Security

> Contrato de segurança da fase: registro de ameaças, riscos aceitos e trilha de auditoria.
> Registro autorado em tempo de planejamento (os 10 PLANs carregam `<threat_model>`), verificado
> retroativamente por `/gsd-secure-phase 04` em 2026-09-23.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Navegador → Next.js (BFF) | Server Actions em `apps/web/app/(app)/inicio/feed-actions.ts`; cookies `HttpOnly` | Conteúdo de publicação, texto de comentário, alvos de curtida |
| Next.js `proxy.ts` → API Hono | `Authorization: Bearer` encaminhado; host do tenant resolvido de `tenant_domains` | JWT, `tenant_id`, `app_role` |
| API → Postgres | `api_user` (`NOBYPASSRLS`) + `set local role authenticated` por transação (`withTenantTx`) | Toda linha do feed, sob RLS por tenant |
| API/worker → internet pública (unfurl) | `undici.Agent` com **connector de socket** em `guard.ts` | URLs postadas por admins do tenant — a superfície SSRF da fase |
| Navegador → Supabase Storage | URLs assinadas de vida curta, emitidas pela API; anexos lidos como **blob**, nunca pelo `Location` | Mídia e anexos privados |

---

## Threat Register

66 ameaças (`T-04-01`..`T-04-65` mais a linha de cadeia de suprimentos `T-04-SC`, carregada em
04-05). **58 `mitigate` verificadas presentes · 8 `accept` substanciadas · 0 abertas.**

| Faixa | Plano | Total | Fechadas | Abertas |
|-------|-------|-------|----------|---------|
| T-04-01..09 | 04-01 | 9 | 9 | 0 |
| T-04-10..13 | 04-02 | 4 | 4 | 0 |
| T-04-14..21 | 04-03 | 8 | 8 | 0 |
| T-04-22..28 | 04-04 | 7 | 7 | 0 |
| T-04-29..37 + T-04-SC | 04-05 | 10 | 10 | 0 |
| T-04-38..42 | 04-06 | 5 | 5 | 0 |
| T-04-43..48 | 04-07 | 6 | 6 | 0 |
| T-04-49..53 | 04-08 | 5 | 5 | 0 |
| T-04-54..60 | 04-09 | 7 | 7 | 0 |
| T-04-61..65 | 04-10 | 5 | 5 | 0 |

*Status: open · closed · open — abaixo do limiar `high` (não bloqueante)*
*Somente ameaças abertas em `high` ou acima contam para `threats_open`.*

### Âncoras de evidência (as de maior severidade)

| Threat ID | Sev | Categoria | Evidência lida na auditoria |
|-----------|-----|-----------|------------------------------|
| **T-04-29** | **critical** | Info Disclosure / EoP | `packages/modules/feed/server/unfurl/guard.ts:160-180` — `undici.Agent` com **função connector** que roda `net.isIP` + `checkBlocked` **antes** de delegar a `buildConnector({lookup: guardedLookup})`; `:132-147` resolve com `all:true` e recusa se **qualquer** endereço estiver bloqueado; `:86-121` desembrulha a forma mapeada `::ffff:`. Deny-list cobre `169.254/16`, `127/8`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`, `fe80::/10`. Provado em `tests/unfurl-guard.test.ts:242,257,273,289` (com controle positivo), `:336`. **Ver residual R1.** |
| T-04-03 | high | EoP | `server/routes.ts:110` `requirePermission('feed.post.create')`; `feed.test.ts:252` (403 a membro) + `:281` (a política virada torna o mesmo membro autor) |
| T-04-18 | high | EoP | FK composto `(parent_id,parent_depth)→(id,depth)` + `feed_comments_parent_shape_chk`; `service.ts:1174-1181` insere o literal `0`; pgTAP 090 casos 1-5 (2 positivos, 3 negativos) |
| T-04-31 | high | Info Disclosure | `service.ts:430-441` engole a recusa; `feed-unfurl.test.ts:314-339` afirma **ausência** — 201, `linkPreview` nulo, corpo sem `/blocked\|refus\|bloquead\|ssrf/i` |
| T-04-34 | high | Info Disclosure | `20260923010104_feed_link_previews.sql:23` `unique (tenant_id, url_hash)` + `:25` política de isolamento; pgTAP 090 casos 25-27 (colisão dentro do tenant, livre entre tenants, controle positivo) |
| T-04-44 | high | EoP | `service.ts:948` `canDelete` derivado no servidor + `:1247-1257` predicado independente da API; `e2e/feed-comments.spec.ts:260-263` afirma que o controle está **ausente** na linha de outro membro |
| T-04-49/50 | high | Info Disclosure | Um único 404 nu; `not-found.tsx` não recebe props nem lê param; `/post` **não** está em `proxy.ts:22-40 PUBLIC`; `e2e/feed-share.spec.ts:115-141` |
| T-04-54 | high | EoP | `author_user_id = ctx.userId` no `for update` (`:696-699`), no update (`:758-760`) e no delete (`:826-828`); `feed-edit-delete.test.ts:222` recusa um segundo admin **e o autor passa no mesmo teste** |
| T-04-37 / T-04-SC | high | Tampering | `package.json:27,29` pinos exatos `open-graph-scraper@6.12.0` e `undici@7.29.1` (sem caret), idem `pnpm-lock.yaml:3526,4002`; `postinstall: null` auditado em `04-RESEARCH.md:210-222`; aprovação humana bloqueante registrada em `04-05-SUMMARY.md:269` |

O registro completo linha a linha, com citação de arquivo e faixa de linhas para cada uma das 66,
está na trilha de auditoria abaixo e nos blocos `<threat_model>` dos 10 PLANs.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-04-A1 | T-04-07 (medium, EoP) | Revogação de membership vale no próximo request, não no atual: `packages/core/server/auth/require-auth.ts:55-56` resolve `membershipForUser(userId)` **por request, sem cache** (AUTH-06, D-09) e `:74-75` devolve 403 em `status === 'blocked'`. A janela é um request em voo | Registro de planejamento 04-01 | 2026-09-23 |
| R-04-A2 | T-04-08 (low, Repudiation) | Sem log de auditoria dedicado para criação de publicação em V1; `feed_posts.author_user_id` + `created_at` dão a atribuição mínima | Registro de planejamento 04-01 | 2026-09-23 |
| R-04-A3 | T-04-09, T-04-20, T-04-47 (low, DoS) | **Não existe rate limit por membro em V1** — a aceitação é honesta, não uma descrição errada. `likePost`/`unlikePost` são no-ops idempotentes (`service.ts:1008-1013`), o que limita o dano de repetição | Registro de planejamento 04-01/03/07 | 2026-09-23 |
| R-04-A4 | T-04-26 (low, DoS) | `AttachmentRow` lê um blob; o teto de 25 MiB só-PDF da Fase 3 limita o custo; nenhuma URL assinada aparece em payload | Registro de planejamento 04-04 | 2026-09-23 |
| R-04-A5 | T-04-28 (low, Info Disclosure) | `service.ts:157` projeta `a.filename` (o nome que o admin subiu), nunca a chave do objeto no Storage | Registro de planejamento 04-04 | 2026-09-23 |
| R-04-A6 | T-04-60 (medium, Repudiation) | Sem trilha de auditoria de edição/remoção além da linha: `edited_at`/`deleted_at`/`author_user_id`, mais os eventos `post.edited` e `post.deleted` que carregam `actorUserId` (`service.ts:780-786`, `:835-841`) | Registro de planejamento 04-09 | 2026-09-23 |

Os seis registros acima foram **verificados factualmente** nesta auditoria, não apenas transcritos:
cada alegação de código por trás da aceitação foi lida. Nenhuma das 8 linhas `accept` era um
descarte silencioso.

---

## Residuais — mitigação declarada presente, endurecimento além dela

Nenhum destes conta para `threats_open`: em todos, a mitigação que o plano declarou **está
presente, no limite certo, e provada por teste**. São endurecimentos acima da linha declarada.

### R1 — T-04-29: lacunas da deny-list IPv6 (A-WR-01/02, CONFIRMADO)

`guard.ts:62-69` omite `ff00::/8`, `2002::/16` (6to4), `2001::/32` (Teredo) e `::/96`
(IPv4-compatible). **Lido e confirmado nesta auditoria.**

O auditor **não** marcou T-04-29 como aberta, e a razão está registrada aqui para que a decisão
possa ser revista: a mitigação declarada — connector de socket + `net.BlockList` + lookup
`all:true`, reentrada a cada hop — está presente e provada com controle positivo, e **todo vetor
que a ameaça nomeia** (metadata `169.254.169.254`, loopback, RFC1918, CGNAT, ULA/link-local IPv6)
**está bloqueado**. Das quatro faixas, só `2002:a9fe:a9fe::` mapeia para um endereço de metadata, e
alcançá-lo exige uma rota de relay 6to4 que o runtime do Cloud Run não tem; `ff00::/8` não é
conectável por TCP; `::/96` é depreciada pela RFC 4291 e não tem rota. Real, mas contingente ao
ambiente.

**Correção:** quatro linhas `blockList.addSubnet` em `denyList()`.

### R2 — T-04-04: trunca-depois-linkifica (A-CR-02, CONFIRMADO)

`packages/modules/feed/ui/PostCaption.tsx:27-33` corta em `truncateAt` e **então** chama
`linkify(shown)`. O comentário da linha 28 declara a intenção correta ("Truncate FIRST, then link:
a URL cut in half must not become a clickable half-URL") enquanto a linha 29 produz exatamente o
resultado que ele quer evitar: uma URL cortada vira um `<a href>` vivo cujo domínio registrável
difere do da URL inteira, e **o alvo muda** quando o leitor toca "… mais".

É engano de alvo de link, não XSS armazenado — os quatro elementos declarados de T-04-04
(armazenamento em texto plano, escape do React, atributos `rel`, só http(s)) estão intactos, e o
href sempre é igual ao texto renderizado. O alcance em V1 é limitado a autores `admin_tenant`.

**Registrar para V2 antes de a postagem por membros existir.** Correção: linkificar primeiro,
truncar a lista de nós depois.

### R3 — T-04-30: contagem de redirects ilimitada (A-WR-03, CONFIRMADO)

`unfurl/job.ts:112,158` usam `redirect: 'follow'` sem `maxRedirections`, então vale o padrão de 20
hops do undici onde o `CLAUDE.md` especifica **≤3**. Não é bypass de SSRF — o connector é reentrado
a cada hop, provado em `unfurl-guard.test.ts:273` — e está limitado em tempo pelo `AbortSignal` de
5 s e em bytes por `maxResponseSize`. Só amplificação.

**Correção:** `maxRedirections: 3` no Agent.

### R4 — A-WR-08: toque duplo descurte — **sem peso de segurança**

`ui/PostCard.tsx:205` passa `onDoubleTapLike={toggle}`, então o toque duplo numa publicação já
curtida a descurte. É a própria curtida do membro, na própria sessão, num endpoint autorizado e
idempotente no servidor. **Nenhuma consequência de privilégio, divulgação ou integridade — não
mapeia para nenhuma linha do registro e é defeito puro de correção/UX.** T-04-39 continua fechada.

Rastreado como dívida de validação em `04-VALIDATION.md` (Manual-Only), não aqui.

---

## Sinalizações fora do registro (WARNING — não contam para `threats_open`)

### 1. Cookies `rede_continue` e `tenant_slug` sem `secure` (C-WR-01, CONFIRMADO)

`apps/web/proxy.ts:199-204` e `:218-223` definem `maxAge/sameSite/path/httpOnly` mas **omitem
`secure`**, enquanto `apps/web/lib/supabase/cookie-options.ts:12` e
`apps/web/app/(app)/actions.ts:46` — a política do próprio repositório — carregam
`secure: process.env.NODE_ENV === 'production'`. **Lido e confirmado nesta auditoria.**

Este é exatamente o `threat_flag: auth-path` que `04-08-SUMMARY.md` levantou sem mapeamento para o
modelo de ameaças, pedindo explicitamente que `/gsd-secure-phase` desse a segunda opinião. O
veredito: **low** se registrado — ambos os valores são não-secretos (um caminho `/post/{id}` e um
slug de tenant), `HttpOnly` + `SameSite=Lax` estão presentes, e `safeContinuePath`
(`lib/continue-path.ts:43-52`) revalida no uso contra forma de caminho, `//host`, `/\host`,
caracteres de controle e um teto de 512 chars. **Não alcança a barra `high` e não bloqueia.**

**Correção:** acrescentar `secure: process.env.NODE_ENV === 'production'` nos dois pontos.

### 2. Dois SUMMARYs sem seção `## Threat Flags`

`04-02-SUMMARY.md` e `04-07-SUMMARY.md` (os outros oito têm). **Não é lacuna de código** — T-04-10..13
e T-04-43..48 foram verificadas de forma independente e as seis estão fechadas. É omissão de
processo: vale corrigir para que a ausência da seção nunca seja lida como "nenhuma".

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-23 | 66 | 66 | 0 | `gsd-security-auditor` via `/gsd-secure-phase 04` (ASVS L1, block_on `high`) |

**Método:** registro autorado em tempo de planejamento, então o auditor verificou mitigações em vez
de varrer por ameaças novas. Arquivos de implementação foram apenas lidos — nada foi modificado. Os
achados do `04-REVIEW.md` (A-CR-02, A-WR-01/02/03, A-WR-08, C-WR-01) entraram como **pistas** e cada
um foi re-derivado do código nesta sessão; todos confirmados como descritos.

**Verificação independente do orquestrador:** três citações foram conferidas à mão antes de aceitar
o veredito — o connector de socket e a deny-list em `guard.ts:58-72,160-182`, os dois `cookies.set`
sem `secure` em `proxy.ts:196-224`, e o trunca-depois-linkifica em `PostCaption.tsx:25-36`. As três
batem exatamente com o relatado.

---

## Sign-Off

- [x] Todas as ameaças têm disposição (mitigate / accept / transfer) — 58 mitigate, 8 accept
- [x] Riscos aceitos documentados no Accepted Risks Log — 6 registros cobrindo as 8 linhas `accept`
- [x] `threats_open: 0` confirmado
- [x] `status: verified` no frontmatter
- [ ] Residuais R1, R2, R3 e a sinalização de cookie fechados — **abertos por decisão**, nenhum
      bloqueante; rota de fechamento é `/gsd-code-review 04 --fix` (R1 e R3 são de uma linha cada)

**Approval:** verified 2026-09-23
