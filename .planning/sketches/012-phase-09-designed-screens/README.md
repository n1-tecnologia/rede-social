---
sketch: 012-phase-09-designed-screens
name: phase-09-designed-screens
phase: 09
question: "A Rede social — a linha Início · Explorar com 'Encontrar pessoas' (botão, ícone abaixo de 360px, ausente para o moderador); o Explorar e os seus três estados vazios, a visão do moderador e a publicação do próprio membro; o Seguir / Seguindo; a tela 'Siga para ver' e a recusa no meio da sessão; o perfil de outro membro com as contagens; as listas privadas Seguidores e Seguindo e o diretório para o membro; o compositor do membro com fotos, vídeo e limites; o painel da plataforma com a linha 'Rede social', a confirmação ao ativar e a folha de limites; o aviso de comentário, o histórico de moderação, o Reels de membro e o selo por público — lê como a própria linguagem do protótipo e das telas já aprovadas, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - abas-interativa
  - abas-390-inicio
  - abas-390-explorar
  - abas-360-botao
  - abas-320-icone
  - abas-moderador
  - abas-social-desligada
  - abas-desktop
  - explorar-populada
  - explorar-vazio-a
  - explorar-vazio-b
  - explorar-vazio-c
  - explorar-carregando
  - explorar-erro
  - explorar-propria-menu
  - explorar-propria-excluir
  - explorar-moderador-menu
  - explorar-moderador-remover
  - explorar-320-textos-longos
  - explorar-desktop
  - explorar-desktop-moderador
  - seguir-estados
  - seguir-alternativa-confirmar
  - trancada-390
  - trancada-320-nome-longo
  - trancada-carregando
  - trancada-nao-encontrada
  - trancada-recusa-na-sessao
  - trancada-desktop
  - perfil-outro-seguir
  - perfil-outro-seguindo
  - perfil-numeros
  - perfil-proprio
  - perfil-equipe-visto-por-membro
  - perfil-membro-visto-por-equipe
  - perfil-carregando
  - perfil-erro
  - perfil-desktop
  - seguidores-390
  - seguindo-390
  - listas-vazios
  - listas-carregando
  - listas-erro
  - listas-320-truncar
  - membros-membro-390
  - membros-equipe-390
  - membros-desktop
  - listas-alternativa-botoes
  - seguindo-alternativa-linha-sai
  - criar-membro-vazio
  - criar-membro-fotos
  - criar-membro-video-processando
  - criar-membro-video-rejeitado
  - criar-membro-sem-video
  - criar-membro-limites
  - criar-membro-editar
  - criar-contraste-administrador
  - criar-membro-desktop
  - plataforma-interativa
  - plataforma-desligada
  - plataforma-sem-feed
  - plataforma-confirmar
  - plataforma-ligada
  - plataforma-celular
  - plataforma-limites-celular
  - plataforma-limites-video
  - plataforma-limites-erro
  - plataforma-limites-salvando
  - plataforma-limites-desktop
  - aviso-sino
  - aviso-push
  - moderacao-historico
  - reels-de-membro
  - selo-por-publico
status: approved
approved: true
approved_by: igor.vboas
approved_at: 2026-10-19
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-09, design-review, D-33, UI-04, social, explorar, follow, member-posts]
---

# Sketch 012: Fase 9 — Rede social (portão de revisão D-33 / D-365)

## Design Question

A Fase 9 liga, por tenant e por módulo (`social`), duas coisas ao app: os membros passam a **seguir**
uns aos outros e a **publicar** no feed, e um novo olhar do Início, o **Explorar**, mostra as
publicações de quem o membro segue (e as dele). O Início continua sendo a voz da organização.

O protótipo do time de design desenha só três peças disso — o botão **Seguir**, o bloco de
**contagens** e a **linha de pessoa** (`FollowButton`, `ProfileStats`, `UserListItem`) — e elas são
**portadas**, não redesenhadas (quadros de diferença de porte). Ele **não** desenha as superfícies
que `09-UI-SPEC.md` § Scope lista como **[designed]**, e D-33 / D-365 mandam desenhar e revisar
**antes de codar**:

1. a **linha de áreas** do Início, com "Encontrar pessoas" (UI-D-491, UI-D-492);
2. o **Explorar**: os três estados vazios, o próprio post, a visão do moderador (UI-D-493 a UI-D-497);
3. a tela **"Siga para ver"** e a recusa no meio da sessão (UI-D-499, UI-D-500);
4. o **bloco de contagens** do perfil de outro membro e os seus estados (UI-D-501);
5. as **listas privadas** Seguidores e Seguindo e o **diretório** para o membro (UI-D-502, UI-D-503);
6. o **compositor do membro** (UI-D-504);
7. a linha **"Rede social"** do painel da plataforma, a confirmação ao ativar e a folha de limites
   (UI-D-505);
8. o **aviso de comentário**, a frase do **histórico de moderação**, o **Reels** de membro e o
   **selo "Administrador"** por público (UI-D-506 a UI-D-509).

A pergunta de design: tudo isso lê como a linguagem do protótipo — ground `#f5f7fb` com cartões
brancos, raios de 12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor
de destaque, que é a do tenant —, em claro e escuro, sob qualquer marca, em 320 e 390px?

## How to View

```
open .planning/sketches/012-phase-09-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto, sem folha de estilo remota,
sem webfont remota e sem imagem real: as fotos são gradientes que simulam o conteúdo dos membros. O
arquivo abre offline e pode ser enviado como está. É um artefato de revisão sob `.planning/`:
nenhum código de aplicação o importa, empacota ou referencia. As primitivas e o chrome (tokens,
TopBar, BottomNav, trilho, `Button`, `Card`, `EmptyState`, `ConfirmDialog`, `BottomSheet`, `Switch`,
`Toast`, abas sublinhadas, banner de push) são os dos sketches 010 e 011, sem mudança; só a seção 15
do CSS é da Fase 9.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** e as duas cores do tenant, mais quatro presets (Rede Social neutro,
  Demo roxo, Lab verde e um **Amarelo claro** cuja tinta derivada é escura). Escrevem as cinco
  variáveis `--brand-*` como `brandStyleVars()` faz no servidor.
- Os links das onze seções. Cada quadro leva o seu nome em `data-frame` e a rota ou o componente na
  etiqueta (`/inicio`, `/post/[postId]`, `/membros/[id]`, `/perfil/seguidores`, `/criar`,
  `HubTabs`, `FollowButton`, `LockedPost`, `FollowCounts`, `ModuleToggles`, `SocialLimitsSheet`,
  `NotificationItem`, `ModerationLogRow`, `ReelsOverlay`, `AdminBadge`). Telefones de 390px (e de
  360 e 320px onde o contrato pede) ficam ao lado de uma coluna de desktop de 680px com o trilho
  de 240px.
- **O que responde ao toque:** os botões Seguir / Seguindo (viram na hora, ficam pendentes por um
  instante, reconciliam; a contagem do perfil acompanha); as abas Início / Explorar do primeiro
  quadro (e o botão flutuante só em Explorar); a tela trancada (Seguir abre a publicação; há um
  botão para reiniciar); Seguindo (o botão vira Seguir e a linha fica); o painel da plataforma
  (ligar abre a confirmação, desligar é direto, "Configurar limites" abre a folha, "Permitir
  vídeo" mostra os campos de vídeo, um valor fora da faixa mostra o erro, salvar fecha com o
  toast). Nada sai da página e nenhum formulário envia.

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 9 não acrescenta
nenhum token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso** (UI-SPEC
§ Design System). Se algo no desenho parecer um valor novo, é defeito do desenho, não proposta. Todo
texto de interface vem do § Copywriting Contract de `09-UI-SPEC.md` ou dos catálogos já entregues;
o que não está em nenhum dos dois tem **sublinhado tracejado** e está no achado F-3. O tenant é
**Rede Demo**; quem olha é **Ana Ribeiro**.

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Oito perguntas, além da revisão visual:

### (a) A linha de áreas e o "Encontrar pessoas" (UI-D-491, UI-D-492)

Duas abas sublinhadas e, só para o membro, um botão `outline` à direita (um `IconButton` abaixo de
360px). Ver `abas-390-inicio`, `abas-390-explorar`, `abas-360-botao`, `abas-320-icone`.

*A decidir:* a linha lê como uma linha só? A linha fina inferior atravessa o botão (achado F-7).
Em 360px as abas rolam uns 6px (achado F-4): sobe o ponto de troca para 375px?

### (b) Explorar vazio com o botão flutuante à vista (UI-D-494, UI-D-496)

O CTA "Encontrar pessoas" é `outline` de propósito, porque o botão flutuante de marca continua na
tela. Ver `explorar-vazio-a` e `explorar-vazio-b`; o moderador (`explorar-vazio-c`) não tem nenhum
preenchimento de marca.

*A decidir:* os dois convivem, ou o CTA deveria ser o preenchimento de marca (e o flutuante sumir)?

### (c) "Siga para ver" (UI-D-499)

Um cartão: foto de 80px com um disco de cadeado, "Siga {nome} para ver", uma linha de corpo e o
botão de marca. Nada de pré-visualização. Ver `trancada-390`, `trancada-320-nome-longo`.

*A decidir:* basta, ou o membro espera ver ao menos uma pista do que está trancado? (O servidor não
manda conteúdo: D-469.)

### (d) As contagens e o perfil (UI-D-501)

Sem a célula "Publicações"; texto simples no perfil dos outros, links no `/perfil`. Ver
`perfil-outro-seguir`, `perfil-proprio`, `perfil-numeros`.

*A decidir:* a ausência de "Publicações" e de "Mensagem" deixa o perfil incompleto? Durante a carga
o botão deveria reservar o espaço (achado F-8)?

### (e) Botões de marca em lista e linhas que ficam (UI-D-502, UI-D-503)

Até 25 "Seguir" de marca numa tela, e uma linha que continua depois de deixar de seguir. Ver
`seguidores-390`, `membros-membro-390` e as duas alternativas desenhadas:
`listas-alternativa-botoes` (contorno) e `seguindo-alternativa-linha-sai`.

*A decidir:* a lista barulhenta é o preço certo de seguir em um toque?

### (f) O compositor do membro (UI-D-504)

A subtração do compositor do administrador, a linha de público junto do contador e os estados do
vídeo. Ver `criar-membro-vazio`, `criar-membro-video-processando`, `criar-membro-video-rejeitado`.

*A decidir:* "Quem segue você vê esta publicação em Explorar." fica sob o texto, ao lado do contador
(como desenhado)? E "Publicar" desabilitado até o vídeo ficar pronto se explica sozinho?

### (g) A linha "Rede social" no painel (UI-D-505)

O botão "Configurar limites" sob a descrição (achado F-6), a nota do Feed, a confirmação e a folha.
Ver `plataforma-interativa`, `plataforma-ligada`, `plataforma-confirmar`, `plataforma-limites-video`.

*A decidir:* o botão sob a descrição, ou à esquerda do interruptor em telas largas? As ajudas de
campo (achado F-3) dizem o que precisam?

### (h) Avisos, histórico e selo (UI-D-506 a UI-D-509)

Ver `aviso-sino`, `aviso-push`, `moderacao-historico`, `reels-de-membro`, `selo-por-publico`.

*A decidir:* a linha de contexto "Publicação removida" (achado F-2) ou um chip? O título do push é o
ator (contrato) ou o tenant (o que o código entregou, achado F-9)?

## Achados do próprio desenho, para a revisão fechar

Desenhar e medir mostrou nove pontos que o UI-SPEC não fecha ou que contradiz o código entregue.
Medidas feitas neste arquivo, com a fonte reserva do sistema (a Manrope não está instalada onde o
arquivo foi aberto): confirmar com a Manrope na compilação real.

1. **F-1 — o espaço entre cartões do feed.** O UI-SPEC (§ Spacing Scale, exceção 1) diz 12px
   (`gap-3`). O `FeedList` entregue usa `gap-6`, 24px, na lista e no esqueleto. Explorar reusa o
   mesmo componente, então o desenho mostra 24px. O texto do UI-SPEC deve ser corrigido, e a
   exceção do 12px fica só para o `EmptyState` e a linha `MemberRow`.
2. **F-2 — "chip" ou linha de contexto.** UI-D-507 fala em um chip "Publicação removida"; o catálogo
   entregue em 09-07 (`moderation.log.context.feedPost`) desenha uma linha de contexto 12/400
   terciária sob a frase. O desenho segue o entregue. Ver `moderacao-historico`.
3. **F-3 — texto que não está no contrato.** Proposto só para poder desenhar: a ajuda de cada
   campo da folha de limites ("De {mín} a {máx}. Padrão: {n}."), o diálogo de deixar de seguir da
   alternativa #1 e o toast da alternativa #5. Aparecem com sublinhado tracejado. O primeiro precisa
   de chaves no catálogo se for aprovado.
4. **F-4 — a largura do "Encontrar pessoas".** O contrato estima 140px; medido, ~168px, e as duas
   abas pedem ~156px. Em 390px sobram 24px; em 360px as abas ficam com ~150px e rolam uns 6px.
   Opções: subir o ponto de troca para 375px, ou encurtar o rótulo. Ver `abas-360-botao`.
5. **F-5 — o estado pendente em 96px.** Spinner, espaço e "Seguindo" ocupam ~77px dos 96px: cabe,
   com ~10px por lado. Tolera uma fonte um pouco maior, não um rótulo mais longo.
6. **F-6 — onde fica "Configurar limites".** O contrato não diz. O desenho o põe sob a descrição:
   em 390px a coluna de texto tem ~180px e o botão ~142px, então ao lado do interruptor espremeria
   a descrição.
7. **F-7 — a linha fina sob as abas.** A `Tabs` entregue não desenha linha inferior. O desenho põe
   uma na linha inteira (abas e botão). Confirmar.
8. **F-8 — o botão durante a carga das contagens.** O contrato manda duas células de esqueleto e
   não diz se o botão reserva 44px. Sem reserva, ele aparece e empurra a página.
9. **F-9 — o título do push.** UI-D-506 manda "{ator} comentou na sua publicação"; o código de
   09-07 usa o nome do tenant. O desenho segue o contrato (alinhar o código ou o contrato).

## Escolhas padrão a confirmar (09-UI-SPEC.md § Pending User Confirmation)

As onze foram tomadas numa sessão sem perguntas. A seção 11 do arquivo as lista com o quadro que
mostra cada uma; as que têm alternativa visível a desenham: **#1** (`seguir-alternativa-confirmar`),
**#5** (`seguindo-alternativa-linha-sai`) e **#6** (`listas-alternativa-botoes`). A **#9** já foi
confirmada pelo product owner em 2026-10-19. A **#11** (o texto jurídico de termos, regras e
privacidade para conteúdo de terceiros, D-478) não é de design: a confirmação ao ativar aponta para
um item de `docs/DEPLOY.md` e o texto deve ser decidido antes de ligar a Rede social em qualquer
tenant.

## O que não foi redesenhado

Fica como entregue e fora de revisão: o cartão do post, a folha de comentários, curtir, compartilhar,
o cartão de link, o player de vídeo e os estados de envio (04); a linha de prévia do link no
compositor; a `ProfileHeader` (D-45); o `ConfirmDialog`, a `BottomSheet` e o `Toast`; e o corpo do
Início. Não existem nesta fase: lista "Minhas publicações", botão "Mensagem", contagem de
publicações no perfil, ponto de "novas" na aba Explorar, busca de pessoas dentro de Explorar, raia
"Seguindo" no Reels, lista de seguidores aberta, tela de novo aceite dos termos, anexo de PDF e
seletor de comunidade para o membro, aviso de novo seguidor e uma aba nova na navegação.

## Decisions already fixed upstream

Já decididas em `09-CONTEXT.md` (D-466..D-484) e `09-UI-SPEC.md` (UI-D-491..UI-D-512) e **fora de
revisão**; estão aqui para o desenho ser lido com elas em mente: o grafo é só entre membros e a
equipe fica fora dele (D-467); as listas são privadas (D-468); o servidor manda só o nome e a foto
do autor numa publicação trancada (D-469); o botão de seguir só aparece onde o UI-D-498 diz (D-470);
o selo segue o público da publicação (D-482, já confirmado);
`social` desligada esconde tudo e não apaga nada (D-483).

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo claro mostra a tinta escura derivada). Tudo que é da marca recolore: o sublinhado da
   aba, os botões "Seguir", "Publicar" e "Salvar limites", o botão flutuante, o interruptor ligado e
   o anel do foco; e só isso. "Seguindo", "Encontrar pessoas", as contagens, o disco do cadeado e o
   selo "Administrador" (cor secundária) não são cor de marca.
2. **Linha de áreas** — toque em Explorar no primeiro quadro; olhe as larguras de 360 e 320px.
3. **Explorar** — os três vazios, o menu do moderador e as duas confirmações.
4. **Seguir** — toque nos botões; veja o estado pendente e a falha (seção 10).
5. **"Siga para ver"** — toque em Seguir; a publicação abre; reinicie.
6. **Perfil, listas e diretório** — as contagens simples contra as linkadas; as linhas partidas.
7. **Compositor** — os estados do vídeo e as recusas de limite.
8. **Plataforma** — ligue, cancele, confirme, abra os limites, erre um valor, salve.
9. **Avisos** — o sino, o push, o histórico, o Reels e o selo.
10. **As perguntas (a) a (h) e os nove achados.**
11. **Texto** — sinalize qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/social.json`,
    `feed.json`, `members.json`, `profile.json`, `notifications.json`, `moderation.json` ou
    `platformModules.json` / `platform.social.json`.

## O que este portão prende

**Esta revisão é o portão, não uma formalidade.** Enquanto a linha `012-phase-09-designed-screens`
de `../MANIFEST.md` disser `pending` (e o frontmatter deste arquivo `approved: false`), as tarefas
dos planos web da Fase 9 ficam bloqueadas: 09-08 (a linha de áreas, "Encontrar pessoas", Explorar e
os três vazios), 09-09 (o compositor do membro e a remoção pelo moderador), 09-10 (Seguir, contagens,
listas e diretório), 09-11 ("Siga para ver" e a recusa), 09-12 (a linha "Rede social", a confirmação
e a folha de limites) e a caminhada de 09-13. Cada tarefa carrega um `precondition` que lê a linha
do MANIFEST e exige que o estado comece por "approved".

**Os planos de API 09-01 a 09-07 não esperam por esta revisão** e já foram executados.

## Recording the outcome

**O registro é uma edição do usuário, não do agente** (D-33). Para aprovar:

- no frontmatter deste arquivo: `status: approved`, `approved: true`, `approved_by: <seu nome>`,
  `approved_at: <AAAA-MM-DD>`, `approval_kind: provisional`;
- na linha 012 de `../MANIFEST.md`, a coluna Winner passa de `pending` a
  `approved (provisional) por <nome>, <data>`.

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e
`status: changes-requested`). O desenho é revisado e a revisão se repete. Onde o desenho aprovado e o
`09-UI-SPEC.md` discordarem, vale o desenho, e o UI-SPEC é corrigido no mesmo commit (os achados F-1,
F-2, F-4, F-6 e F-9 pedem exatamente isso).

Seguindo o precedente dos sketches 001 a 011, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio.
