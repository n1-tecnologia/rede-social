---
sketch: 010-phase-08.5-designed-screens
name: phase-08.5-designed-screens
phase: 08.5
question: "As superfícies de membro de Cursos que o protótipo não desenha — a página da live (contagem, janela de entrada, replay, cancelada, exclusiva), a seção de compra e os avisos de bloqueio do curso e da aula, o 'Ver como aluno' com a faixa de pré-visualização, o novo interruptor 'Exige concluir a aula anterior', a lista do que o produto libera e o 'Compra concluída' com cursos e lives, e o Reels como ícone na barra de cima — lêem como a própria linguagem do protótipo e da Loja, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - barra-cursos-ligado-390
  - barra-cursos-ligado-320-gap-1
  - barra-cursos-desligado
  - reels-pela-barra-cromo-escuro
  - catalogo-cursos-misto-exclusivo-e-aberto
  - catalogo-cursos-com-progresso
  - catalogo-produto-arquivado
  - catalogo-chips-categoria-320
  - catalogo-vazio-e-categoria-vazia
  - catalogo-carregando-e-erro
  - catalogo-desktop-3-colunas
  - lives-proximas-e-gravadas
  - lives-ao-vivo-agora-exclusiva-cancelada
  - lives-vazio
  - curso-aberto-0
  - curso-aberto-em-andamento
  - curso-concluido
  - curso-exclusivo-um-produto
  - curso-exclusivo-varios-produtos-folha
  - curso-exclusivo-sem-produto-a-venda
  - curso-exclusivo-falha-loja
  - curso-exclusivo-com-aula-aberta
  - curriculo-modulo-bloqueado-por-sequencia
  - curriculo-aulas-estados-aberta-concluida-andamento-exclusiva-bloqueada
  - curso-sem-aulas
  - curso-320-titulo-longo-faixa
  - aula-player-nao-concluida
  - aula-player-concluida-proxima-brand
  - aula-pratica-sem-video-com-materiais
  - aula-proxima-bloqueada-sequencia-e-exclusiva
  - aula-bloqueio-compra
  - aula-bloqueio-sequencia
  - aula-indisponivel
  - live-antes-da-janela
  - live-hoje
  - live-na-janela-antes-do-inicio
  - live-ao-vivo
  - live-replay-antes-e-tocando
  - live-encerrada-sem-replay
  - live-cancelada-apos-o-fim
  - live-exclusiva
  - hub-linha-publicada-olho
  - curso-admin-ver-como-aluno
  - previa-aluno-faixa-curso-e-player
  - aula-form-exige-anterior-primeira-aberta
  - curriculo-admin-legenda-exige-a-anterior
  - produto-libera-comunidade-curso-live
  - compra-concluida-curso
  - compra-concluida-varios-misto
  - retorno-ao-curso-toast
  - toasts
status: approved
approved: true
approved_by: igor.vboas
approved_at: 2026-10-15
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-08.5, design-review, D-33, UI-04, D-417, courses, members]
---

# Sketch 010: Fase 08.5 — Liberação de cursos e lives para o membro (portão de revisão D-417)

## Design Question

A Fase 08.5 abre a escola para os membros. Com o módulo `courses` ligado, a aba **Cursos** entra
no meio da BottomNav e o Reels vira um ícone na TopBar. O membro vê o catálogo (Cursos · Lives),
abre um curso, assiste às aulas com progresso e retomada, e encontra cadeados em palavras quando
o curso é exclusivo (comprado na Loja) ou quando uma aula ou um módulo exige o anterior. Cada live
tem uma página que diz o que o membro pode fazer agora. O admin ganha o "Ver como aluno" e o
interruptor "Exige concluir a aula anterior"; a Loja passa a dizer que o produto libera cursos e
lives, além de comunidades.

O protótipo do time de design desenha **quatro** destas telas — o catálogo, a página do curso
aberta, o player e a lista de lives — e elas são **portadas**, não redesenhadas. Ele **não**
desenha o resto. Por isso `08.5-UI-SPEC.md` marca estas superfícies como sem protótipo, e D-417
(o padrão D-365 da Loja, o mesmo portão D-33 / UI-04 das fases anteriores) manda desenhar e
revisar **antes de codar**:

1. **A casca com Cursos** (UI-D-423): a aba Cursos na BottomNav, o Reels como o slot mais à
   esquerda do grupo da direita da TopBar (antes de Loja), o `gap-1` abaixo de 360px, o `/reels`
   aberto pelo slot com o cromo escuro de mídia, e o trilho do desktop com o Reels no topo do
   grupo de baixo. Com `courses` desligado, nada muda.
2. **A seção de compra e os avisos de bloqueio do curso** (UI-D-428, UI-D-430): "Curso
   exclusivo" nas quatro variantes — um produto, vários produtos com a folha "Opções de acesso",
   nenhum à venda, falha da Loja — com o link "Assistir à aula aberta"; e as legendas de bloqueio
   nas faixas de módulo e nas linhas de aula.
3. **A página de bloqueio da aula** (UI-D-431): "Aula exclusiva" (compra) e "Aula ainda
   bloqueada" (sequência), mais "Aula indisponível".
4. **A página da live do membro** (UI-D-435, UI-D-436): antes da janela, hoje, dentro da janela
   antes do início, ao vivo, replay antes do toque e tocando, terminou sem replay, cancelada
   depois do fim e exclusiva.
5. **"Ver como aluno"** (UI-D-437): o olho de 44px na linha publicada do hub, o botão na página
   do curso do admin e a faixa de prévia na página do curso e no player.
6. **O interruptor da aula** (UI-D-438): "Exige concluir a aula anterior" nos três estados
   (habilitado, primeira aula, aula aberta) e a legenda " · Exige a anterior" no editor.
7. **A Loja** (UI-D-439, UI-D-440): "Libera o acesso a" com comunidade, curso e live, e o
   "Compra concluída" com um curso, uma live, vários alvos misturados, e o retorno ao curso com
   o toast.

As telas portadas aparecem aqui como **quadros de diferença de porte** (pôster 3:4 em vez de 4:5,
a etiqueta de cadeado da Loja no lugar da pílula dourada do protótipo, capa sempre colorida, sem
ouro nem esmeralda, tipo normalizado para 12 / 14 / 16 / 24): estão no arquivo para a revisão, mas
o portão não as prende (ver "O que não é preso pelo portão").

A pergunta de design: tudo isso lê como a linguagem do protótipo e da Loja — ground `#f5f7fb` com
cartões brancos, raios de 12px, alvos de 44px, a escala 12/14/16/24 com pesos 400/700, as
proporções do protótipo (pôster 3:4, herói 16:10, faixa 16:6, miniatura 16:9) e **uma** cor de
destaque que é a do tenant — em claro e escuro, sob qualquer marca, em 320 e 390px?

## How to View

```
open .planning/sketches/010-phase-08.5-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota e sem imagem real: as capas são gradientes que simulam o conteúdo do tenant (uma é
**paisagem**, para mostrar os recortes 3:4, 16:10, 16:6 e 16:9 da mesma imagem, UI-D-444). O
arquivo abre offline e pode ser enviado como está. Manrope renderiza se estiver instalada na
máquina; sem ela o fallback do sistema renderiza com as mesmas medidas.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`.
- **Cor primária / Cor secundária** e quatro presets (Rede Social neutro, Demo roxo, Lab verde e um
  **Amarelo claro** cuja tinta derivada é escura) — escrevem as cinco variáveis `--brand-*` como
  `brandStyleVars()` faz no servidor. O readout mostra os valores derivados e o contraste da tinta.
- Os links de seção pulam para cada superfície. Cada quadro carrega o nome da lista do UI-SPEC
  § Sketch gate em `data-frame` e a rota ou o componente na etiqueta. Telefones de 390px (e de
  320px onde o contrato pede) ficam ao lado de uma coluna de desktop de 680px com o trilho de 240px.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 08.5 não acrescenta
nenhum token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso** (UI-SPEC
§ Design System). Se algo no desenho parecer um valor novo, é defeito do desenho, não proposta.
Todo texto de interface vem do § Copywriting Contract de `08.5-UI-SPEC.md`, com dados de exemplo
nas interpolações (o tenant é **Rede Demo**). O vocabulário é "curso", "aula", "módulo", "live",
"exclusivo / exclusiva", "bloqueada", "liberar"; não há assinatura nem plano.

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Oito mensagens, além da revisão visual:

### (a) Reels como ícone na TopBar (UI-D-423)

Com `courses` ligado, quatro ícones de 44px (Reels, Loja, Notificações, Suporte) mais o avatar
de 36px, com 4px entre eles abaixo de 360px. O link do logo continua com ≥ 44px.

*A decidir:* a barra ainda lê em 320px, ou um dos slots deveria ir para o menu do perfil abaixo
de 360px? Ver `barra-cursos-ligado-320-gap-1`.

### (b) Uma capa para todas as faixas e miniaturas (UI-D-429, UI-D-430)

O truque do protótipo é uma arte só, mais o numeral e o estado. As faixas de módulo e as
miniaturas de aula usam a capa do curso; não há imagem por aula (WR-08 fica adiado).

*A decidir:* com 15 miniaturas iguais de 80px, a lista lê como uma lista de aulas distintas, ou as
linhas deveriam trocar a miniatura por um quadrado com o número? Ver
`curriculo-aulas-estados-aberta-concluida-andamento-exclusiva-bloqueada`.

### (c) Linhas bloqueadas são links para uma página de bloqueio (A-UI-3)

Tocar numa aula exclusiva ou presa pela sequência navega para a URL da aula, que mostra o aviso.
Um link compartilhado e uma URL lembrada caem na mesma superfície.

*A decidir:* cair numa página de aula que diz "Aula exclusiva" é mais claro que uma folha aberta no
lugar? Ver `aula-bloqueio-compra` e `aula-bloqueio-sequencia`.

### (d) "Comprar para liberar" para um produto e para vários (A-UI-2)

O curso e a live usam o mesmo rótulo com um produto (link para a página do produto) e com vários
(abre "Opções de acesso"). A página da comunidade exclusiva diz "Ver produto" / "Ver opções".

*A decidir:* o curso e a live deveriam repetir "Ver produto" / "Ver opções" da comunidade? Ver
`curso-exclusivo-um-produto` e `curso-exclusivo-varios-produtos-folha`.

### (e) O único preenchimento da marca do player passa de "Marcar como concluída" para "Próxima aula" (UI-D-432)

Antes de concluir, "Próxima aula" é `outline`; depois, o bloco "Aula concluída" (não interativo)
toma o lugar do botão e "Próxima aula" ganha a marca.

*A decidir:* a troca é legível, ou o membro perde o próximo passo? Ver
`aula-player-nao-concluida` e `aula-player-concluida-proxima-brand`.

### (f) "Começa em 22 de outubro, às 19:00." sem grade de contagem regressiva (UI-D-435)

A página da live mostra a data absoluta e a dica "O link para entrar aparece 15 minutos antes do
início."; não desenha a grade de dias/horas/minutos do protótipo.

*A decidir:* a data absoluta basta? Ver `live-antes-da-janela` e `live-hoje`.

### (g) "Ao vivo agora" sobre a mídia sem vermelho (UI-D-434)

A pílula sobre mídia com o glifo `Radio` e as palavras, sem ponto pulsando; o vermelho fica
reservado para ações destrutivas.

*A decidir:* glifo e palavras bastam? Ver `lives-ao-vivo-agora-exclusiva-cancelada` e
`live-ao-vivo`.

### (h) A faixa de prévia neutra (UI-D-437)

Em `?ver=aluno` a faixa `bg-bg-tertiary` diz "Você está vendo como aluno." / "O progresso não é
registrado neste modo." e oferece "Voltar para a edição"; o player não tem zona de conclusão.

*A decidir:* uma faixa neutra basta para o admin não achar que o curso está quebrado porque
"Marcar como concluída" sumiu? Ver `previa-aluno-faixa-curso-e-player`.

### Achados do próprio desenho, para a revisão fechar

Desenhar em 320px e 390px mostrou quatro pontos que o UI-SPEC não fecha:

1. **A faixa do módulo em 320px.** Com 288px de largura a faixa 16:6 tem 108px de altura; um
   título de duas linhas mais a legenda do cadeado encostam na pílula "Módulo 02" do canto
   superior. O contrato não diz o que cede. Opções: o título em uma linha abaixo de 360px, ou a
   pílula some quando o título quebra. Ver `curso-320-titulo-longo-faixa`.
2. **A pílula "Gravada" numa live sem gravação.** O status vem do servidor (`recorded` =
   "Gravada") depois do fim, com ou sem replay; o desenho mostra "Gravada" sobre "Esta live já
   aconteceu. A gravação não está disponível.". A pílula deveria sumir nesse estado? Ver
   `live-encerrada-sem-replay`.
3. **O micro-título das seções.** O § Typography do UI-SPEC lista o `SectionTitle` em 16/700,
   mas o `SectionTitle` entregue (variante `micro`) é 12/700 em caixa alta na marca, como em
   "Libera o acesso a" desde 08.2. O desenho usa o componente entregue ("SOBRE O CURSO",
   "CONTEÚDO DO CURSO", "NESTE MÓDULO"). Confirmar, ou corrigir o UI-SPEC.
4. **A linha publicada do hub em 320px.** Com a pílula "Publicado", o chevron e o olho de 44px, o
   nome do curso fica com cerca de 70px e quebra em duas linhas antes de truncar. É o que o
   contrato pede ("o nome trunca primeiro"); confirmar que lê. Ver `hub-linha-publicada-olho`.

## For the product owner (not design)

Duas perguntas que só o product owner responde; a resposta fica aqui, ao lado da aprovação:

1. **Quem comprou continua assistindo a um curso arquivado?** D-426 diz que **não**: um curso
   arquivado ou despublicado some para todo membro, compradores inclusive, e as páginas
   respondem "Curso indisponível"; o progresso fica guardado e volta se o curso for republicado.
   A visão "Arquivado" para compradores foi adiada e mudaria isso.

   > Resposta: segue o padrão (D-426, não). Aprovado em chat ("aprovado") em 2026-10-15 sem resposta explícita; o padrão proposto vale.

2. **O progresso de quem não comprou, nas aulas abertas, aparece no cartão exclusivo?** A-UI-5
   diz que **sim**: quem concluiu uma aula aberta vê a barra no pôster "Exclusivo" (D-421 manda o
   cartão exclusivo mostrar tudo que mostraria aberto; D-430 manda a barra aparecer depois de uma
   aula concluída). Ver `catalogo-cursos-com-progresso`.

   > Resposta: segue o padrão (A-UI-5, sim). Aprovado em chat ("aprovado") em 2026-10-15 sem resposta explícita; o padrão proposto vale.

## Decisions already fixed upstream

Já decididas em `08.5-CONTEXT.md` (D-419..D-434) e `08.5-UI-SPEC.md` (UI-D-423..UI-D-445) e
**fora de revisão**. Estão aqui para o desenho ser lido com elas em mente, não para serem
re-litigadas:

- **D-419** — a aba Cursos entra na BottomNav nesta fase, com o rebaixamento do Reels (D-401).
- **D-420** — para o membro, `/cursos` é Cursos | Lives; o gestor mantém o hub.
- **D-421** — o cartão exclusivo segue o cartão da comunidade: tudo à mostra, mais "Exclusivo" e
  "Produto arquivado"; uma grade só, mais nova primeiro; chips só com categoria publicada.
- **D-422** — o admin ganha "Ver como aluno"; nenhum progresso é gravado para um `admin_tenant`.
- **D-423** — o curso exclusivo mostra o currículo inteiro em títulos com cadeados; o conteúdo de
  uma aula exclusiva nunca sai do servidor.
- **D-424** — o caminho de compra é a seção do topo da Loja, mais o toque numa aula exclusiva.
- **D-425** — a página do produto e o "Compra concluída" listam tudo que o produto libera.
- **D-426** — um curso arquivado ou despublicado some para todo membro, compradores inclusive.
- **D-427** — a aula conclui perto do fim do vídeo e também pelo botão "Marcar como concluída".
- **D-428** — o bloqueio sequencial existe por módulo e por aula; o servidor é a autoridade.
- **D-429** — a aula aberta ignora o bloqueio sequencial e grava progresso, mesmo sem compra.
- **D-430** — o membro vê o progresso na página, nas linhas e no cartão, e o vídeo retoma.
- **D-431** — Lives: ao vivo e agendadas primeiro, depois gravadas com replay; cancelada fica
  até o fim previsto; exclusiva com o cadeado.
- **D-432** — o link de entrada só sai do servidor de 15 minutos antes do início até o fim previsto.
- **D-433** — o acesso à live ou ao curso da aula do replay abre o replay.
- **D-434** — cada live tem a sua página em `/cursos/lives/{liveId}`.
- **UI-D-423..UI-D-445** — as decisões visuais do UI-SPEC, das quais este desenho é a
  materialização (casca e Reels, catálogo e papéis, grade e chips, `CourseCard`, página do curso,
  seção de compra, currículo, linha e miniatura, página de bloqueio, player, gravações silenciosas,
  lista de lives, página da live, relógio, "Ver como aluno", interruptor da aula, lista do
  produto, "Compra concluída", indisponíveis, Loja desligada e equipe, acessibilidade, glifos e
  proporções, e onde ficam os textos).

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo claro mostra a tinta escura derivada). Tudo que é da marca recolore — a aba Cursos, o
   sublinhado da aba, o chip ativo, o único botão preenchido de cada tela, os links de texto, os
   micro-títulos e as barras e anéis de progresso — e só isso; etiquetas, pílulas, cadeados,
   checks, numerais e a faixa de prévia continuam neutros.
2. **Casca** — com `courses` ligado, Cursos é a aba do meio e o Reels é o slot mais à esquerda da
   TopBar; em 320px os quatro slots e o avatar ainda leem; `/reels` mantém o cromo escuro; com
   `courses` desligado nada mudou.
3. **Curso exclusivo** — lê como uma comunidade exclusiva: etiqueta de cadeado, capa colorida, a
   seção do topo nas quatro variantes, o link da aula aberta; nada lê como pressão (pílula
   dourada, capa cinza, contagem regressiva).
4. **Currículo** — as faixas de módulo e as linhas de aula dizem cada bloqueio em palavras
   ("Libera ao concluir …", "Aula exclusiva") e as páginas de bloqueio mandam o membro para algum
   lugar útil.
5. **Player** — o único preenchimento da marca passa de "Marcar como concluída" para "Próxima
   aula"; o bloco de concluída não é interativo.
6. **Live** — exatamente uma zona de estado por momento: antes, hoje, dentro da janela, ao vivo,
   replay, terminou sem replay, cancelada, exclusiva.
7. **Prévia** — "Ver como aluno" e a faixa deixam claro por que "Marcar como concluída" não existe
   para o admin.
8. **Interruptor da aula** — explica os dois estados desabilitados antes do toque.
9. **Loja** — a página do produto lista comunidades, cursos e lives com os seus tipos; "Compra
   concluída" lê igual seja o que for que ela libera.
10. **As mensagens acima** — responda (a) a (h) e os quatro achados.
11. **As duas perguntas do product owner** — escreva as respostas nas linhas "Resposta" acima.
12. **Texto** — sinalize qualquer palavra a mudar; ela cai em
    `apps/web/messages/pt-BR/courses.member.json` (membro), `courses.json` (admin) ou
    `store.courses.json` (Loja).

Fora do escopo desta revisão: `Tabs`, `Chip`, `StatusPill`, `PageHeader`, `Card`, `Switch`,
`BottomSheet`, `ConfirmDialog`, `EmptyState`, `VideoPlayer`, `LockedSection`, `ExclusiveBadge`,
`ProductChoiceSheet` e o `PurchaseDialog` de 08.2. Já existem e aparecem aqui só como contexto ao
redor das peças revisadas (a mudança de cada um é a da sua seção).

## O que não é preso pelo portão

As telas portadas do protótipo podem seguir só com o UI-SPEC: a **grade do catálogo**, os
**estados abertos da página do curso** (0%, em andamento, concluído), o **currículo**, o
**player** e a **lista de lives**. Os quadros delas (`catalogo-*`, `lives-*`, `curso-aberto-*`,
`curso-concluido`, `curriculo-*`, `aula-player-*`, `aula-pratica-*`) estão aqui só como diferenças
de porte (3:4, etiquetas, tipo normalizado) para a revisão ver. A regra D-365 prende apenas as
superfícies sem protótipo listadas no Scope do UI-SPEC: a página da live, a seção de compra e os
avisos de bloqueio do curso e da aula, "Ver como aluno", o interruptor da aula, a lista do
produto e o "Compra concluída" generalizado, e o slot Reels na TopBar.

## Recording the outcome

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **todas as tarefas que codam uma superfície sem protótipo da Fase 08.5 ficam
bloqueadas** — as tarefas de UI dos planos 08.5-07 (página do curso e a seção de compra), 08.5-08
(player e página de bloqueio), 08.5-09 (página da live), 08.5-10 ("Ver como aluno" e o
interruptor da aula), 08.5-11 (a aba Cursos e o slot Reels) e 08.5-12 (a lista do produto e o
"Compra concluída"). Cada uma carrega um `precondition` que afirma
`grep -q '^approved: true' .planning/sketches/010-phase-08.5-designed-screens/README.md` e que
para enquanto este arquivo disser `false`. Os planos de API (08.5-01, 03, 04 e 05) e o catálogo
portado (08.5-06) não esperam por esta revisão.

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
o `08.5-UI-SPEC.md` discordarem, vale o desenho, e o UI-SPEC é corrigido no mesmo commit.

Seguindo o precedente dos sketches 001 a 009, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner da linha 010 em `../MANIFEST.md` só é atualizada se você pedir.
