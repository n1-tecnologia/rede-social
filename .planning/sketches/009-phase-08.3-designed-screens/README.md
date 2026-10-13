---
sketch: 009-phase-08.3-designed-screens
name: phase-08.3-designed-screens
phase: 08.3
question: "As superfícies de administração de Cursos que o protótipo não desenha — o hub com as abas Cursos · Trilhas · Lives e suas listas, o formulário do curso, a página do curso com o editor de módulos e aulas (setas, cadeado sequencial, pílulas de processamento, aviso de publicação bloqueada), o formulário da aula com os estados do vídeo e os materiais, as categorias, a trilha com a escolha e a ordem dos cursos, a live com o cancelamento e o replay, as confirmações e a linha em Configurações — lêem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - configuracoes-linha-cursos
  - hub-cursos-todos-390
  - hub-cursos-320-chips-rolando
  - hub-cursos-rascunhos-com-processando
  - hub-cursos-vazios-todos-rascunhos-publicados-arquivados
  - hub-cursos-carregando-e-erro
  - hub-trilhas-ativas-e-vazio
  - hub-lives-proximas-passadas-cancelada-e-vazio
  - hub-desktop-680
  - curso-rascunho-publicar-liberado
  - curso-rascunho-aviso-2-aulas-processando
  - curso-publicado-despublicar
  - curso-arquivado-nota
  - curso-sem-modulos
  - curso-modulo-sem-aulas
  - curso-modulo-exige-anterior-e-aula-aberta
  - curso-320-titulo-longo-setas
  - curso-carregando
  - modulo-folha-nova-e-editar-primeiro-modulo
  - formulario-curso-vazio
  - formulario-curso-preenchido-com-produtos
  - formulario-curso-loja-desligada
  - formulario-curso-categoria-folha-e-nivel
  - formulario-curso-10-itens-e-erros
  - formulario-curso-recorte-3-4-vs-16-10
  - aula-vazia
  - aula-enviando-37
  - aula-processando
  - aula-pronta-12-34
  - aula-falhou
  - aula-pratica-sem-video-materiais-10-de-10
  - aula-materiais-enviando-e-falha
  - aula-aberta-curso-sem-produto
  - categorias-lista-e-folha
  - categorias-remover-desabilitado
  - trilha-formulario-com-curso-nao-publicado
  - trilha-escolher-cursos-folha
  - live-formulario-nova
  - live-editar-gravada-com-replay
  - live-replay-folha-agrupada-por-curso
  - live-cancelada
  - confirmacoes-publicar-arquivar-despublicar-remover-cancelar-descartar
  - toasts
status: approved
approved: true
approved_by: Igor Boas (igor.vboas), product owner
approved_at: 2026-10-13
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-08.3, design-review, D-33, UI-04, D-417, courses]
---

# Sketch 009: Fase 08.3 — Cursos: admin de curso, módulo, aula, trilha e live (portão de revisão D-417)

## Design Question

A Fase 08.3 cria a administração de **Cursos**: o admin do tenant monta cursos (capa, título, frase
de venda, descrição, categoria, nível, instrutor, "O que você vai dominar", carga horária e os
produtos da Loja que liberam o acesso), organiza módulos e aulas (vídeo direto no Mux ou aula
prática, "Aula aberta", materiais), publica quando todo vídeo está pronto, agrupa cursos em
trilhas ordenadas e agenda lives com link externo, cancelamento e replay. Os membros ainda não
veem nada: a área de membros é a fase seguinte.

O protótipo do time de design (`reference/frontend-design/app/membros/**`) **só tem a área de
membros** — catálogo, página do curso, player, trilhas, lives e progresso. Não existe nenhuma tela
de autoria. Por isso `08.3-UI-SPEC.md` marca todas as superfícies abaixo como `[designed]`, e
D-417 (o padrão D-365 da Loja, o mesmo portão D-33 / UI-04 das Fases 4 a 8) manda desenhar e
revisar **antes de codar**:

1. **A linha "Cursos" em Configurações → Administração** (UI-D-389), depois de Loja e antes de
   Mídia — a única porta do admin nesta fase (sem aba, sem slot na TopBar, sem linha no trilho).
2. **O hub `/cursos`** (UI-D-390, 391, 392, 401): o h1, as abas de área **Cursos · Trilhas ·
   Lives**, e por aba a linha do título com o controle de criar, os chips de status, a lista em
   linhas (não pôsteres), os vazios, o esqueleto e os erros; a linha "Categorias" na aba Cursos.
3. **A página do curso** (`/cursos/[courseId]`, UI-D-394, 395, 396, 397): o herói 16:10, as
   pílulas, a zona de publicação nos quatro estados (rascunho liberado, rascunho bloqueado com o
   aviso, publicado com "Despublicar", arquivado com a nota) e o editor de currículo — cartões
   de módulo com o numeral, a legenda "Exige o anterior", as setas e o lápis; linhas de aula com
   a miniatura 16:9 em quatro estados, a meta em palavras, as pílulas e as setas; "Nova aula"; a
   folha do módulo.
4. **O formulário do curso** (`/cursos/novo`, `…/editar`, UI-D-393, 409): a prévia 3:4, a
   categoria numa linha de escolha com folha, o nível em chips, o instrutor com foto, até 10
   itens, a carga horária, o bloco "Liberado pelos produtos" (só com a Loja ligada) e a folha de
   produtos; os erros; "Arquivar curso".
5. **O formulário da aula** (`/cursos/[courseId]/aulas/…`, UI-D-398, 399): os **cinco estados do
   vídeo** (vazio, enviando, processando, pronto, falhou), o switch "Aula aberta" com os dois
   helpers, a lista de materiais com setas, remoção, envio em andamento, falha e o teto de 10.
6. **As categorias** (`/cursos/categorias`, UI-D-400): a lista com as contagens e a folha com
   "Remover categoria" desabilitado quando há cursos.
7. **A trilha** (`/cursos/trilhas/…`, UI-D-402): o formulário com a lista ordenada de cursos, o
   curso "Não publicado", a `CoursePickerSheet` e "Arquivar trilha".
8. **A live** (`/cursos/lives/…`, UI-D-403): o formulário com o par Data / Horário, a duração, o
   link `https://`, o status derivado, a linha Replay com a `LessonPickerSheet` agrupada por curso,
   "Cancelar live" e a nota da live cancelada.
9. **As confirmações e os toasts** (UI-D-404, 405): perigo para arquivar, despublicar, remover e
   cancelar; marca para publicar; os toasts de uma frase.

A pergunta de design: tudo isso lê como a linguagem que vocês já assinaram — ground `#f5f7fb` com
cartões brancos, raios de 12px, alvos de 44px, a escala 12/14/16/24 com pesos 400/700, as
proporções do protótipo (pôster 3:4, miniatura 16:9, herói 16:10, numeral do módulo) e **uma** cor
de destaque que é a do tenant — em claro e escuro, sob qualquer marca, em 320 e 390px?

## How to View

```
open .planning/sketches/009-phase-08.3-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem imagem real: as fotos são gradientes que simulam o conteúdo do tenant (uma é
clara de propósito e uma é **paisagem**, para mostrar o recorte central 3:4 do catálogo e o
recorte 16:10 da página do curso da mesma imagem). O arquivo abre offline e pode ser enviado como
está. Manrope renderiza se estiver instalada na máquina; sem ela o fallback do sistema renderiza
com as mesmas medidas.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`.
- **Cor primária / Cor secundária** e quatro presets (Rede Social neutro, Demo roxo, Lab verde e um
  **Amarelo claro** cuja tinta derivada é escura) — escrevem as cinco variáveis `--brand-*` como
  `brandStyleVars()` faz no servidor. O readout mostra os valores derivados e o contraste da tinta.
- Os links de seção pulam para cada uma das superfícies. Cada quadro carrega o nome da lista do
  UI-SPEC § Sketch gate em `data-frame` e a rota ou o componente na etiqueta.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 08.3 não acrescenta
nenhum token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso** (UI-SPEC
§ Design System). Se algo no desenho parecer um valor novo, é defeito do desenho, não proposta.
Todo texto de interface vem do § Copywriting Contract de `08.3-UI-SPEC.md`, com dados de exemplo
nas interpolações (o tenant é **Rede Demo**). "Remover", nunca "excl…" ou "apag…".

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Oito mensagens, além da revisão visual:

### (a) Abas para a área, chips para o status (UI-D-390, UI-D-391)

A sub-navegação Cursos · Trilhas · Lives é o `Tabs` sublinhado (o `AreaTabs` do protótipo, que o
membro encontrará na fase seguinte com Início e Progresso na mesma linha); o filtro de status é
uma linha de `Chip`s-link (Todos · Rascunhos · Publicados · Arquivados; Ativas · Arquivadas;
Próximas · Passadas) que rola na horizontal em 320px. Duas linhas de chips empilhadas leriam como
um só filtro.

*A decidir:* a linha sublinhada lê como "onde estou" e a linha de chips como "o que estou
filtrando", ou as duas brigam em 320px? Ver `hub-cursos-320-chips-rolando`.

### (b) Linhas, não pôsteres, nas listas de administração (UI-D-392)

O catálogo do membro será uma grade de pôsteres 3:4; o admin vê **linhas** com a mesma
proporção numa miniatura de 40px (3:4 para cursos; 16:10 com 64px para trilhas e lives), o nome
em até duas linhas, a meta e a pílula em palavras ("Rascunho", "Publicado", "Arquivado", e a
segunda "Processando" num rascunho com vídeo pendente). Reconhecimento e estado valem mais que
marketing aqui.

*A decidir:* a família de linhas lê como a família da Loja e das Comunidades?

### (c) O aviso de publicação bloqueada acima de um botão desabilitado (UI-D-394)

Num rascunho com algum vídeo não pronto, um cartão `bg-warning/10` com `CircleAlert` diz "Não é
possível publicar: {N} aulas ainda processam o vídeo." e lista as aulas como links, **acima** de
"Publicar curso" desabilitado. O `409 video_not_ready` do servidor redesenha o mesmo aviso.

*A decidir:* o aviso acima do botão desabilitado é mais claro que um botão habilitado que recusa
ao toque?

### (d) O numeral do módulo sem a arte (UI-D-395)

O `ModuleCover` do protótipo põe um numeral gigante translúcido sobre a arte da categoria; o
cartão do admin mostra "{N}" 16/700 num quadrado neutro de 32px, sem arte.

*A decidir:* ainda lê como "módulo 1"?

### (e) Setas sempre visíveis, gravando a cada toque (UI-D-397)

As Comunidades reordenam num modo com "Salvar ordem". Num currículo com módulos e aulas na mesma
tela, um modo por pai seria um estorvo: cada seta grava a ordem inteira do pai de uma vez, sem
toast no sucesso (uma região viva anuncia a nova posição) e com todas as setas da lista
desabilitadas enquanto a gravação responde.

*A decidir:* o par de setas sempre presente aperta a linha de aula em 320px com a pílula
"Processando" (`curso-320-titulo-longo-setas`), ou a pílula deveria descer para baixo do título?

### (f) Os cinco estados do vídeo num bloco só (UI-D-398)

Vazio (zona tracejada + "Enviar vídeo" em `outline` + "uma aula sem vídeo é uma aula prática"),
enviando ("{N}% enviado" + "Cancelar envio"), processando (cartão 16:9 com spinner + "Processando o
vídeo…" + "Isso pode levar alguns minutos. Você pode salvar a aula e voltar depois."), pronto (o
player, a duração do asset e "Remover vídeo") e falhou (a zona em erro + "Tentar novamente"). O
formulário salva em qualquer estado; só a publicação do curso espera.

*A decidir:* "Processando o vídeo… Você pode salvar a aula e voltar depois." diz o suficiente para
o admin sair sem medo?

### (g) Linhas de escolha e chips de nível (UI-D-393, UI-D-403)

Categoria e replay são uma linha de 44px com o glifo, o valor e um `ChevronDown` que abre uma
folha de seleção única; o nível são três `Chip`s `aria-pressed` (tocar o ativo limpa). O desenho
segue o contrato: a linha é plana, sem a caixa de um `Input`.

*A decidir:* a linha lê como um campo? Se não, a alternativa barata é desenhá-la com o fundo
`bg-input` do campo.

### (h) Perigo para "Despublicar" e "Cancelar live" (UI-D-404)

Os dois são reversíveis em parte, mas tiram algo dos membros (o curso some do catálogo; o link
da live é desativado). O desenho usa o tom de perigo nos dois diálogos, como em arquivar e
remover; "Publicar curso?" é o único diálogo da marca.

*A decidir:* concordam com o vermelho, ou despublicar deveria ser neutro?

### Achados do próprio desenho, para a revisão fechar

Desenhar em 320px e 390px mostrou três pontos que o UI-SPEC não fecha:

1. **"Aberto para todos os membros." na live.** O bloco de produtos da live reusa a linha "nenhum
   produto" do curso (`courses.form.products.none`), e no formulário da live a concordância pede
   "Aberta". Opções: uma chave própria (`courses.live.form.productsNone`) ou uma frase neutra que
   sirva aos dois.
2. **A linha de aula sem meta.** O contrato dá à meta "{mm:ss}" quando o vídeo está pronto e
   "Prática" quando não há vídeo; uma aula com vídeo **processando** ou **falho** não tem nenhum
   dos dois, então o desenho mostra só o título e a pílula. Aceitável, ou a meta deveria dizer
   "Vídeo" nesses casos?
3. **A linha de escolha plana** (questão g): sem a caixa do campo, em 320px a linha da categoria
   fica visualmente próxima da linha "Gerenciar categorias" abaixo dela. Confirmar a forma.

## For the product owner (not design)

Duas perguntas que só o product owner responde; a resposta fica aqui, ao lado da aprovação:

1. **"Reativar curso" para cursos arquivados (A-UI-3).** D-413 nomeia `rascunho → publicado →
   arquivado` e o despublicar; não nomeia um caminho de volta do arquivado. O desenho **não**
   mostra "Reativar curso": a página do curso arquivado tem só a nota, e os planos entregam sem o
   controle. Ele é desejado? (Se sim, é um plano curto depois: um botão `outline` no lugar da
   nota e um `PATCH` de estado.)

   > Resposta: _pendente — aprovação provisória registrada em 2026-10-13 sem resposta a esta pergunta; os planos seguem como desenhados até o product owner decidir_

2. **Materiais ampliados ou só PDF (A-UI-1).** D-410 lê "qualquer tipo que o pipeline aceita":
   PDF, planilhas, slides e imagens, até 50 MB cada, até 10 por aula. Os planos implementam essa
   leitura ampliada — o helper lê "Até 10 arquivos de até 50 MB cada: PDF, planilhas, slides e
   imagens." e as linhas dizem "PDF", "Planilha", "Slides", "Imagem". Uma resposta "só PDF"
   estreita **uma constante** (a lista de mimes do contrato) numa tarefa rápida depois: o helper
   passa a ler "… cada: PDF." e nada mais muda.

   > Resposta: _pendente — aprovação provisória registrada em 2026-10-13 sem resposta a esta pergunta; os planos seguem como desenhados até o product owner decidir_

## Decisions already fixed upstream

Já decididas em `08.3-CONTEXT.md` (D-400..D-417) e `08.3-UI-SPEC.md` (UI-D-389..UI-D-412) e
**fora de revisão**. Estão aqui para o desenho ser lido com elas em mente, não para serem
re-litigadas:

- **D-400** — o módulo é `courses`, a rota é `/cursos`, o rótulo é "Cursos".
- **D-401** — o membro entra pela BottomNav na fase seguinte (Cursos ganha a aba de Reels); nesta
  fase nenhuma aba, slot ou linha no trilho.
- **D-402** — o admin entra pela linha "Cursos" em Configurações; `/cursos` é o hub com as abas
  Cursos | Trilhas | Lives.
- **D-403** — permissão `courses.manage`, `admin_tenant` por construção.
- **D-404** — um curso liga a zero ou mais produtos da Loja; qualquer um abre o curso; sem produto,
  aberto a todo membro.
- **D-405** — `courses` não exige `store`; com a Loja desligada o bloco de produtos some.
- **D-406** — o cadeado sequencial (`requires_previous`) é editável agora e aplicado na fase dos
  membros; o primeiro módulo nunca bloqueia.
- **D-407** — "Aula aberta" (`is_free`) por aula, escolhida pelo admin.
- **D-408** — progresso por membership modelado, sem uso nesta fase.
- **D-409** — vídeo opcional e só por upload direto no Mux; duração e miniatura vêm do asset,
  nunca digitadas; sem links do YouTube/Vimeo.
- **D-410** — materiais: até 10 por aula, 50 MB cada, os tipos que o pipeline aceita, URLs
  assinadas.
- **D-411** — categorias por tenant (nome + capa, sem ícone), gerenciadas dentro da aba Cursos.
- **D-412** — instrutor é texto livre mais uma foto opcional.
- **D-413** — só o curso tem estado (`rascunho → publicado → arquivado`, despublicar volta a
  rascunho); publicar é recusado enquanto algum vídeo não está pronto; arquivar nunca apaga.
- **D-414** — reordenar com setas para cima/baixo e um `PUT …/order` idempotente; sem arrastar.
- **D-415** — uma trilha é um caminho ordenado sobre cursos publicados; um curso despublicado some
  dela até voltar.
- **D-416** — uma live é uma entrada de agenda com estado derivado do relógio; cancelar é um
  estado, nunca um delete.
- **D-417** — este portão de desenho antes de qualquer tarefa de UI (o padrão D-365 / D-33).
- **UI-D-389..UI-D-412** — as decisões visuais do UI-SPEC, das quais este desenho é a
  materialização (linha em Configurações, hub e abas, controles de criar e chips, linhas de lista,
  formulário do curso, página do curso e zona de publicação, cartão de módulo e linha de aula,
  folha do módulo, persistência da ordem, formulário da aula e estados do vídeo, materiais,
  categorias, vazios/carregamento/erros, trilha e escolha de cursos, live e replay, confirmações,
  toasts, catálogo, acessibilidade, glifos, imagens e proporções, durações, desktop e o que o
  membro vê).

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo claro mostra a tinta escura derivada). Tudo que é da marca recolore — o sublinhado da
   aba, o chip ativo, o controle de criar, os envios, "Publicar curso", os checks das folhas e o
   Switch ligado — e só isso; pílulas, numerais, setas, miniaturas e o aviso continuam neutros.
2. **Configurações** — a linha "Cursos" aparece depois de Loja e antes de Mídia; nada mais no
   chrome muda (sem aba, sem slot na TopBar, sem linha no trilho do desktop).
3. **`/cursos`** — lê como as abas de área do protótipo (Cursos · Trilhas · Lives) com os chips de
   status embaixo; os chips rolam em 320px; cada aba tem um controle de criar da marca e os seus
   próprios vazio, carregamento e erro. Confira o quadro de 320px com o título de 120 caracteres e
   as duas pílulas.
4. **Página do curso** — a decisão de publicar fica onde a prontidão é visível: o aviso acima de
   "Publicar curso" desabilitado; "Despublicar" em `outline` no curso publicado; a nota no
   arquivado. O currículo lê como cartões de módulo com o numeral e linhas de aula com setas
   sempre visíveis; a linha de 320px com título longo, "Processando" e setas continua usável.
5. **Formulários** — o curso, os cinco estados do vídeo da aula, a lista de materiais, as
   categorias, a trilha com a sua folha e a live com a folha do replay lêem como as telas de admin
   do próprio app; os recortes 3:4 e 16:10 da mesma imagem estão visíveis.
6. **Confirmações** — perigo para arquivar, despublicar, remover e cancelar; marca para publicar;
   os toasts têm uma frase cada.
7. **As mensagens acima** — responda (a) a (h) e os três achados.
8. **As duas perguntas do product owner** — escreva as respostas nas linhas "Resposta" acima.
9. **Texto** — sinalize qualquer palavra a mudar; ela cai em
   `apps/web/messages/pt-BR/courses.json` (ou `app.courses.json` para a linha em Configurações).

Fora do escopo desta revisão: `Tabs`, `Chip`, `StatusPill`, `PageHeader`, `Card`, `Switch`,
`ConfirmDialog`, `BottomSheet`, `FileDropZone`, `VideoUploadField`, `EmptyState`, a TopBar, a
BottomNav e o trilho. Já existem e aparecem aqui só como contexto ao redor das peças revisadas.

## Recording the outcome

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **todas as tarefas que codam uma superfície sem protótipo da Fase 08.3 ficam
bloqueadas** — as tarefas de UI dos planos 08.3-06 (catálogo, linha em Configurações, hub e
listas), 08.3-07 (formulário do curso, categorias), 08.3-08 (página do curso, currículo, folha do
módulo, publicação), 08.3-09 (formulário da aula, vídeo, materiais), 08.3-10 (trilhas) e 08.3-11
(lives). Cada uma carrega um `precondition` que afirma
`grep -q '^approved: true' .planning/sketches/009-phase-08.3-designed-screens/README.md` e que
para enquanto este arquivo disser `false`. Os planos de kernel, esquema e API (08.3-01, 03, 04 e
05) não esperam por esta revisão.

**O registro é uma edição do usuário, não do agente.** Para aprovar, cole no frontmatter deste
arquivo, substituindo os valores pendentes:

- `status: approved`
- `approved: true`
- `approved_by: <seu nome>`
- `approved_at: <AAAA-MM-DD>`
- `approval_kind: provisional`

(Estas linhas ficam aqui como lista de propósito: o portão procura `approved: true` no início de uma
linha, e só a linha do frontmatter pode satisfazê-lo.)

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e
`status: changes-requested`). O desenho é revisado e a revisão se repete. Onde o desenho aprovado e
o `08.3-UI-SPEC.md` discordarem, vale o desenho, e o UI-SPEC é corrigido no mesmo commit.

Seguindo o precedente dos sketches 001 a 008, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner da linha 009 em `../MANIFEST.md` só é atualizada se você pedir.
