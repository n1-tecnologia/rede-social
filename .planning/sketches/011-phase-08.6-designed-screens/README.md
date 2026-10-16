---
sketch: 011-phase-08.6-designed-screens
name: phase-08.6-designed-screens
phase: 08.6
question: "A área de membros da escola — o Início com a sequência de estudo, o destaque 'Continue de onde parou', 'Meus cursos', a trilha, a live acontecendo agora ou a próxima live com lembrete (aberta, exclusiva e na prévia do admin), as novas aulas e as categorias; as Trilhas com o caminho e as outras trilhas; o Meu progresso sem certificados; o lembrete na página da live; os seis avisos novos no sino e no push; e o 'Reativar live' do admin — lê como a própria linguagem do protótipo e das telas de Cursos da 08.5, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - abas-cinco-390
  - abas-cinco-320-rolagem
  - abas-sublinhado-vs-pilulas
  - previa-aluno-abas-e-faixa
  - inicio-retomando
  - inicio-comecando
  - inicio-em-dia-aula-aberta
  - inicio-em-dia-sem-aula-aberta
  - inicio-ao-vivo-agora
  - inicio-proxima-live-lembrete-desligado-e-ligado
  - inicio-proxima-live-exclusiva-um-e-varios-produtos
  - inicio-proxima-live-sem-venda-e-falha-loja
  - inicio-sequencia-zero-e-cinco-dias
  - inicio-secoes-ocultas
  - inicio-escola-vazia
  - inicio-carregando-e-erro
  - inicio-320-titulos-longos
  - trilhas-sua-trilha-em-andamento
  - trilhas-sugerida
  - trilhas-etapa-bloqueada-exclusiva
  - trilhas-concluida-rever
  - trilhas-outras-trilhas
  - trilhas-vazio
  - trilhas-carregando-e-erro
  - progresso-com-dados
  - progresso-vazio
  - progresso-curso-exclusivo-revogado
  - progresso-escola-vazia
  - progresso-320-numeros
  - live-antes-da-janela-lembrete-desligado-e-ligado
  - live-lembrete-previa-desativado
  - notificacoes-seis-tipos
  - notificacao-live-reativada
  - notificacao-removida-curso-despublicado
  - push-banners
  - live-admin-cancelada-reativar
  - live-admin-cancelada-apos-inicio
  - dialogo-reativar-live
  - dialogo-cancelar-live-novo-texto
  - toasts
status: pending
approved: false
approved_by: null
approved_at: null
approval_kind: null
changes_requested: []
winner: null
tags: [phase-08.6, design-review, D-33, UI-04, D-417, courses, members, notifications]
---

# Sketch 011: Fase 08.6 — Área de membros (portão de revisão D-417)

## Design Question

A Fase 08.6 transforma o lado do membro da escola (08.5) numa **área de membros**. Para o membro,
`/cursos` ganha cinco itens — **Início · Cursos · Trilhas · Lives · Progresso** —, o Início vira a
casa da área (a sequência de estudo, o destaque "Continue de onde parou", "Meus cursos", a trilha,
a live de agora ou a próxima live com lembrete, as novas aulas e as categorias), as Trilhas mostram
o caminho de uma trilha de cada vez, e o Meu progresso mostra o anel, quatro números e o progresso
curso a curso. A live ganha um lembrete opcional, o sino ganha seis avisos novos (com push), e o
admin ganha o "Reativar live" (D-452).

O protótipo do time de design desenha o **Início**, as **Trilhas** e o **Meu progresso**, e eles são
**portados**, não redesenhados. Ele **não** desenha as onze superfícies que `08.6-UI-SPEC.md` § Scope
lista como sem protótipo, e D-417 (o padrão D-365 da Loja, o mesmo portão D-33 / UI-04 das fases
anteriores) manda desenhar e revisar **antes de codar**:

1. os seis avisos no sino (glifo, ator ou glifo, frase, link) e os seis banners de push (UI-D-460,
   UI-D-461);
2. a **escola vazia** do Início e as **seções ocultas** (uma seção sem dado some, título incluído)
   (UI-D-447);
3. a **live acontecendo agora** no Início, redesenhada neutra, sem vermelho (UI-D-452 a);
4. a **próxima live exclusiva** — "Comprar para liberar" com um produto e com vários, nenhuma à
   venda, falha da Loja (UI-D-452 b);
5. o **lembrete na página da live** de 08.5, na zona "antes da janela" (UI-D-453);
6. o **lembrete desabilitado na prévia do admin** com a sua dica, e a **faixa de prévia na página da
   área** (UI-D-459);
7. as **Trilhas com várias trilhas** (`?trilha=`, "Outras trilhas") e a etapa **"Bloqueada"**
   (UI-D-456);
8. o **Progresso** sem certificados, sem "Conquistas" e sem os blocos de demonstração, e o seu
   cartão **vazio** (UI-D-457);
9. o **"Reativar live"** do admin, a nota de início no passado, o diálogo, e o novo corpo do
   diálogo de cancelar (UI-D-462, D-452);
10. os estados de **carregamento e erro** das três abas novas;
11. a **escolha do estilo da linha de áreas** (UI-D-446): um quadro de comparação, sublinhado
    contra pílulas, para que você possa virar a decisão no portão.

As telas portadas aparecem aqui como **quadros de diferença de porte** ("Premium" do protótipo vira
o cadeado da Loja com "Exclusivo" e a capa em cores; o "Ao vivo" vermelho vira uma linha neutra; sem
ouro; tipo normalizado para 12 / 14 / 16 / 24 com pesos 400 / 700): estão no arquivo para a revisão,
mas o portão D-365 não as prende sozinho (ver "O que este portão prende").

A pergunta de design: tudo isso lê como a linguagem do protótipo e das telas de Cursos da 08.5 —
ground `#f5f7fb` com cartões brancos, raios de 12px, alvos de 44px, a escala 12/14/16/24 com pesos
400/700 e **uma** cor de destaque que é a do tenant —, em claro e escuro, sob qualquer marca, em 320
e 390px?

## How to View

```
open .planning/sketches/011-phase-08.6-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto, sem folha de estilo remota,
sem webfont remota e sem imagem real: as capas são gradientes que simulam o conteúdo do tenant. O
arquivo abre offline e pode ser enviado como está. O arquivo é um artefato de revisão sob
`.planning/`: nenhum código de aplicação o importa, empacota ou referencia.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`.
- **Cor primária / Cor secundária** e quatro presets (Rede Social neutro, Demo roxo, Lab verde e um
  **Amarelo claro** cuja tinta derivada é escura) — escrevem as cinco variáveis `--brand-*` como
  `brandStyleVars()` faz no servidor. O readout mostra os valores derivados e o contraste.
- Os links de seção pulam para cada superfície. Cada quadro carrega o nome da lista do UI-SPEC
  § Sketch gate em `data-frame` e a rota ou o componente na etiqueta (`/cursos`,
  `/cursos?aba=trilhas`, `/cursos?aba=progresso`, `/cursos/lives/[liveId]`, `HubTabs`,
  `MemberHomeTab`, `HomeLive`, `ReminderToggle`, `TrackTimeline`, `StatBlock`, `ProgressRing`,
  `NotificationItem`, `LiveForm`, `PreviewBanner`). Telefones de 390px (e de 320px onde o contrato
  pede) ficam ao lado de uma coluna de desktop de 680px com o trilho de 240px.
- O lembrete do mockup alterna ao toque, só para mostrar os dois estados (sem rede, sem escrita).

Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 08.6 não acrescenta
nenhum token, nenhuma medida de espaçamento, nenhum tamanho de tipo e nenhum peso** (UI-SPEC
§ Design System). Se algo no desenho parecer um valor novo, é defeito do desenho, não proposta. Todo
texto de interface vem do § Copywriting Contract de `08.6-UI-SPEC.md`, com dados de exemplo nas
interpolações (o tenant é **Rede Demo**). Os campos do formulário do admin aparecem como blocos
neutros: são o formulário de 08.3, inalterado; o que está em revisão é só o pé do estado cancelado.

## What is being asked of the design team

Aprovar o desenho aprova o texto e a geometria juntos. Oito perguntas, além da revisão visual:

### (a) A linha de áreas: sublinhado ou pílulas (UI-D-446)

Cinco abas sublinhadas na densidade compacta (a `Tabs` entregue, por `HubTabs`, `px-3`), contra as
pílulas do protótipo. Na aba Cursos os chips de categoria ficam logo abaixo.

*A decidir:* duas fileiras de pílulas leem como um filtro só? Se o time escolher pílulas, UI-D-446
vira o porte do `AreaTabs` (`chipBase`, ativa `bg-brand text-on-brand`, a linha
`flex gap-2 overflow-x-auto px-4 py-2`) e os chips de categoria ficam abaixo. Ver
`abas-sublinhado-vs-pilulas`.

### (b) "Início" duas vezes (D-435)

A primeira aba da BottomNav diz "Início" e o primeiro item da área também diz "Início".

*A decidir:* o "Início" da escola fica claro dentro de "Cursos"? Ver `abas-cinco-390`.

### (c) A live acontecendo agora sem vermelho (UI-D-452)

Uma linha neutra com "Ao vivo agora" e o glifo `Radio`, logo abaixo do destaque, sem ponto
pulsando, sem link de entrada e sem lembrete.

*A decidir:* ela é notada? Ver `inicio-ao-vivo-agora`.

### (d) "Comprar para liberar" em outline na próxima live exclusiva (A-UI-8)

No Início o único preenchimento da marca é o do destaque; a compra da live exclusiva é uma segunda
ação, `outline`.

*A decidir:* basta, ou parece desabilitada? Ver
`inicio-proxima-live-exclusiva-um-e-varios-produtos`.

### (e) O lembrete como botão de largura total (A-UI-9)

A tinta mais "Lembrete ativado", contra uma linha com `Switch`.

*A decidir:* qual lê melhor como "isto está ligado"? Ver
`inicio-proxima-live-lembrete-desligado-e-ligado` e
`live-antes-da-janela-lembrete-desligado-e-ligado`.

### (f) Uma trilha de cada vez (UI-D-456)

Tocar em "Outras trilhas" troca o cartão e o caminho na mesma aba, por link.

*A decidir:* fica claro, ou o membro espera uma página separada? Ver `trilhas-outras-trilhas`.

### (g) Progresso sem certificados e sem "Conquistas" (UI-D-457)

O anel, os quatro números e "Curso a curso", sem placeholder "em breve".

*A decidir:* a página parece completa? Ver `progresso-com-dados` e `progresso-vazio`.

### (h) Ator ou glifo no sino (A-UI-10)

"Dra. Ana Lima publicou o curso …" com o avatar, contra um "Novo curso: …" sem ator com o disco do
capelo.

*A decidir:* qual? Ver `notificacoes-seis-tipos`.

### Achados do próprio desenho, para a revisão fechar

Desenhar mostrou três pontos que o UI-SPEC não fecha:

1. **A faixa de prévia na página da live.** UI-D-459 diz que o lembrete desabilitado e a dica valem
   "também na página da live em prévia", mas não diz se a `PreviewBanner` aparece lá. O desenho
   mostra só o lembrete desabilitado e a dica, sem faixa. Confirmar, ou pedir a faixa. Ver
   `live-lembrete-previa-desativado`.
2. **O disco de play no destaque "Conhecer o curso".** UI-D-449 mantém o disco de play de 28px na
   miniatura nos três estados; no `em_dia` sem aula aberta o CTA perde o `Play` e leva à página do
   curso exclusivo, mas a miniatura ainda mostra o play. Confirmar, ou tirar o disco nesse estado.
   Ver `inicio-em-dia-sem-aula-aberta`.
3. **O banner de push.** Nenhum sketch anterior desenha a notificação do sistema; o quadro
   `push-banners` usa uma tela de bloqueio simulada (chrome do mockup) só para ler o título (o nome
   do tenant) e os corpos. A aparência real é a do sistema operacional.

## For the product owner (not design)

Duas perguntas que só o product owner responde; a resposta fica aqui, ao lado da aprovação:

1. **"Horas assistidas" conta uma aula concluída por "Marcar como concluída" pela duração inteira?**
   D-442 diz que **sim**: o número é a soma das durações das aulas concluídas, como no protótipo,
   não o tempo realmente assistido. Ver `progresso-com-dados`.

   > Resposta:

2. **A saudação fica "Bem-vindo de volta." (com gênero) ou vira "Que bom ver você de novo."
   (neutra)?** O UI-SPEC usa a do protótipo. Ver `inicio-sequencia-zero-e-cinco-dias`.

   > Resposta:

## Decisions already fixed upstream

Já decididas em `08.6-CONTEXT.md` (D-435..D-454) e `08.6-UI-SPEC.md` (UI-D-446..UI-D-465) e **fora
de revisão**. Estão aqui para o desenho ser lido com elas em mente, não para serem re-litigadas:

- **D-435** — para o membro, a aba Cursos abre o Início, e `/cursos` ganha cinco itens.
- **D-436** — "Meus cursos" segue a cascata do protótipo.
- **D-437** — o destaque é sempre um curso para assistir, nunca uma sugestão de trilha.
- **D-438** — a trilha do membro é escolhida automaticamente ("Sugerido" quando nenhuma começou).
- **D-439** — a aba Trilhas lista as trilhas ativas do tenant; a etapa bloqueada continua link.
- **D-440..D-443** — o dia de estudo, a sequência que sobrevive até o fim do dia seguinte, as horas
  assistidas pela soma das durações, e a sequência só para mostrar (sem lembrete, sem prêmio).
- **D-444..D-447** — o lembrete opcional por live, 15 minutos antes, só para quem tem acesso, e que
  segue a live (cancelada avisa quem ativou).
- **D-448..D-451** — quatro publicações avisam os membros, mesmo sem acesso (vitrine); aulas novas
  agrupadas; sino e push.
- **D-452** — uma live cancelada pode ser reativada enquanto o início estiver à frente.
- **D-453** — `support_tenant` recebe os avisos como um membro.
- **D-454** — despublicar ou arquivar um curso retrai os avisos dele.
- **UI-D-446..UI-D-465** — as decisões visuais do UI-SPEC, das quais este desenho é a
  materialização (linha de áreas, Início, saudação, destaque, estante, trilha, live, lembrete, novas
  aulas, categorias, Trilhas, Progresso, portes, prévia, sino, push, "Reativar live",
  acessibilidade, glifos e proporções, e onde ficam os textos).

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo claro mostra a tinta escura derivada). Tudo que é da marca recolore — o sublinhado da
   aba, o único botão preenchido de cada tela, os links "Ver tudo", os micro-títulos, as barras e o
   anel, a tinta da sequência, a do lembrete ligado e o anel da etapa em andamento — e só isso.
2. **Linha de áreas** — as cinco abas leem como uma linha em 390px e rolam em 320px; responda a
   questão (a): sublinhado (como desenhado) ou as pílulas do protótipo.
3. **Início** — lê de cima para baixo como retomar, depois meus cursos, depois minha trilha, depois a
   próxima live; uma seção ausente não deixa buraco; a escola vazia ainda cumprimenta.
4. **Exclusivo** — o conteúdo bloqueado é vitrine ("Exclusivo", capa em cores, "Comprar para
   liberar") e nunca pressão (sem contagem regressiva, sem "Premium", sem capa cinza).
5. **Lembrete** — diz o estado em palavras; o lembrete desabilitado da prévia se explica.
6. **Trilhas** — uma trilha de cada vez, o estado de cada etapa em palavras; "Outras trilhas" troca
   a trilha.
7. **Progresso** — parece completo sem certificados nem "Conquistas"; a sequência é um número,
   nunca uma cobrança.
8. **Sino e push** — os seis avisos nomeiam um curso ou uma live, nunca uma aula.
9. **"Reativar live"** — aparece só enquanto o início está à frente, e o diálogo é da marca, não de
   perigo.
10. **As perguntas acima** — responda (a) a (h) e os três achados.
11. **As duas perguntas do product owner** — escreva as respostas nas linhas "Resposta" acima.
12. **Texto** — sinalize qualquer palavra a mudar; ela cai em
    `apps/web/messages/pt-BR/courses.member.json` (membro), `courses.json` (admin) ou
    `notifications.json` (sino).

## O que este portão prende

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **todas as tarefas dos planos web da Fase 08.6 ficam bloqueadas**: 08.6-08 (a
linha de áreas, a saudação e o destaque), 08.6-09 (a estante, a trilha do Início, as novas aulas e as
categorias), 08.6-10 (Trilhas e Progresso), 08.6-11 (a live do Início, o lembrete e a prévia do
admin) e 08.6-12 (o sino, o push e o "Reativar live"). Cada tarefa desses planos carrega um `precondition` que afirma
`grep -q '^approved: true' .planning/sketches/011-phase-08.6-designed-screens/README.md` e que para
enquanto este arquivo disser `false`.

O UI-SPEC deixaria as telas portadas seguirem sem o portão, mas cada seção portada do Início, das
Trilhas e do Progresso renderiza dentro da mesma leitura e do mesmo `Suspense` que os seus estados
presos (carregamento, erro, vazio, seção oculta); por isso os planos 08 a 12 prendem todas as
tarefas. Prender mais do que o mínimo nunca coda uma superfície não revisada.

**Os planos de API (08.6-01 e 08.6-03 a 08.6-07) nunca esperam por esta revisão** e seguem enquanto
ela acontece.

## Recording the outcome

**O registro é uma edição do usuário, não do agente** (D-417). Para aprovar, cole no frontmatter
deste arquivo, substituindo os valores pendentes:

- `status: approved`
- `approved: true`
- `approved_by: <seu nome>`
- `approved_at: <AAAA-MM-DD>`
- `approval_kind: provisional`

(Estas linhas ficam aqui como lista de propósito: o portão procura `approved: true` no início de uma
linha, e só a linha do frontmatter pode satisfazê-lo.)

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e
`status: changes-requested`). O desenho é revisado e a revisão se repete. Se a questão (a) for
respondida "pílulas", escreva isso em `changes_requested:`: a tarefa da linha de áreas em 08.6-08
porta então o `AreaTabs` no lugar da linha sublinhada compacta (a troca de uma linha de UI-D-446).
Onde o desenho aprovado e o `08.6-UI-SPEC.md` discordarem, vale o desenho, e o UI-SPEC é corrigido
no mesmo commit.

Seguindo o precedente dos sketches 001 a 010, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner da linha 011 em `../MANIFEST.md` só é atualizada se você pedir.
