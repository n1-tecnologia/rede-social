---
sketch: 006-phase-06-designed-screens
name: phase-06-designed-screens
phase: 6
question: "As seis superfícies de Eventos que o protótipo não desenha — o formulário de criar/editar, o par \"Vou\" / \"Não vou\", a entrada do código dentro do ingresso portado, a variante online (\"Entrar\" e as telas de recusa), o cartão \"Próximo evento\" do Início e a tela \"Participantes\" — e os três deltas sobre o que o protótipo desenhou (chips + grade no lugar dos trilhos, a regra da pílula, o tratamento de cancelado) lêem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant?"
screens:
  - eventos-proximos-membro-390
  - eventos-proximos-gestor-390
  - eventos-proximos-320-titulo-longo
  - eventos-carregando-e-erro-de-mais
  - eventos-vazios-proximos-membro-gestor-e-passados
  - eventos-desktop-passados-grade-2-colunas
  - cartaz-regra-da-pilula-9-variantes
  - cartaz-cancelado-foto-cinza
  - detalhe-cancelado-membro
  - detalhe-cancelado-gestor-reativar
  - formulario-novo-vazio-presencial
  - formulario-novo-preenchido-online-criando
  - formulario-erros-depois-do-envio
  - formulario-editar-ativo-cancelar
  - formulario-editar-cancelado-reativar-e-travado
  - dialogos-descartar-cancelar-reativar
  - formulario-desktop-filedropzone
  - segmented-control-seis-estados
  - zona-de-acao-todas-as-linhas
  - detalhe-membro-p0-presencial
  - detalhe-320-p1-presencial
  - ingresso-aberto-vazio
  - ingresso-codigo-errado-sem-capa
  - ingresso-feito
  - ingresso-320-local-60-caracteres
  - ingresso-confirmando-limite-nao-abriu-encerrado-cancelado
  - detalhe-online-p1
  - entrar-dicas-e-pesos
  - entrar-recusas-terminou-cancelado-confirme-nao-encontrado
  - inicio-p0-voce-vai
  - inicio-check-in-presencial
  - inicio-check-in-online
  - inicio-320-titulo-longo
  - inicio-sem-evento
  - participantes-confirmados
  - participantes-presentes-walk-in-removido
  - participantes-320-contagens-4-digitos
  - participantes-online-nao-vao
  - participantes-vazios-esqueletos-erro
  - dialogo-gerar-novo-codigo
status: approved
approved: true
approved_by: Igor Vilas Boas
approved_at: 2026-09-27
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-06, design-review, D-33, UI-04, events]
---

# Sketch 006: Fase 6 — Eventos (portão de revisão D-33)

## Design Question

A Fase 6 cria a aba **Eventos**: a organização publica eventos presenciais e online, os membros
respondem "Vou" / "Não vou", fazem check-in no dia, exportam para a agenda, e a organização vê quem
confirmou e quem esteve lá.

O protótipo (`reference/frontend-design/`, git `05f68b1`) cobre o cartaz 4/5, o herói 16/10 do
detalhe, a grade de infos e o ingresso estilo cartão de embarque. Esses são **portados** (D-66) e
não precisam de desenho. **Não cobre** as seis superfícies abaixo, que `06-UI-SPEC.md` marca
`[designed]` e que D-33 manda desenhar e revisar **antes de codar** (UI-04):

1. **O formulário de criar / editar** (`/eventos/novo`, `/eventos/[id]/editar`), com cancelar e
   reativar.
2. **O par "Vou" / "Não vou"** (a nova primitiva `SegmentedControl`) e a zona de ação inteira.
3. **A entrada do código dentro do ingresso portado** (`/eventos/[id]/check-in`).
4. **A variante online**: a âncora `Entrar` e as telas de recusa de `/eventos/[id]/entrar`.
5. **O cartão "Próximo evento" do Início** (`/inicio`, slot `order: 7`).
6. **A tela `Participantes`** (`/eventos/[id]/participantes`).

E três deltas `[proto]`, desenhados porque mudam o que o time de design desenhou:

- **(a)** os chips "Próximos" / "Passados" e a grade de 1 coluna (celular) / 2 colunas (a partir de
  `sm`) no lugar dos trilhos "Meus / Outros" (UI-D-200);
- **(b)** a regra da pílula: a data absoluta desce para o sobretítulo, e a pílula diz uma coisa só —
  `Cancelado` / `Presente` / `Você vai` / uma data relativa (UI-D-201);
- **(c)** o tratamento de cancelado: a foto em cinza, a pílula `Cancelado` sobre a mídia e a faixa de
  perigo no detalhe (UI-D-202).

A pergunta de design: tudo isso lê como a linguagem que vocês já assinaram — ground `#f5f7fb` com
cartões brancos, raios de 12px, alvos de 44px, a escala 12/14/16/24 com pesos 400/700, e **uma** cor de
destaque que é a do tenant — em claro e escuro, sob qualquer marca?

## How to View

```
open .planning/sketches/006-phase-06-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem React, sem script remoto, sem folha de estilo remota, sem
webfont remota, sem quadro incorporado, sem mapa e sem imagem real: as fotos de capa são gradientes
que simulam o conteúdo do tenant (uma delas é clara de propósito, para julgar o texto branco sobre o
véu). O arquivo abre offline e pode ser enviado por e-mail como está. Manrope renderiza se estiver
instalada na máquina; sem ela o fallback do sistema renderiza com as mesmas medidas.

Controles no topo (chrome do mockup, fora do produto):

- **Tema escuro / Tema claro** — alterna `data-theme` no `<html>`, como o cookie `tria_theme`.
- **Cor primária / Cor secundária** e quatro presets (TRIA neutro, Demo roxo, Lab verde, e um
  **Amarelo** cuja tinta derivada é escura) — escrevem as cinco variáveis `--brand-*` como
  `brandStyleVars()` faz no servidor, incluindo o par escuro e a tinta sobre a primária. O readout
  mostra os valores derivados.
- Os links de seção pulam para cada delta e cada superfície.

O mockup tem um **relógio fictício**: agora = qua., 9 de out. de 2030, 18:20, no fuso do tenant (o
ano só existe para os dias da semana baterem). Os quadros que precisam de outro instante dizem qual
usam na legenda. Todos os valores de cor vêm de `packages/ui/src/styles/tokens.css`. **A Fase 6 não
acrescenta nenhum token, nenhuma medida de espaçamento, nenhum tamanho de tipo, nenhum peso e nenhuma
fonte monoespaçada.** Se algo no desenho parecer um valor novo, é defeito do desenho, não proposta.

## What is being asked of the design team

Seis mensagens, além da revisão visual. Aprovar o desenho aprova o texto e a geometria juntos: cada
string vem do §Copywriting Contract de `06-UI-SPEC.md`.

### (a) "Garantir minha vaga" vira o par gravado "Vou" / "Não vou" (D-205)

O protótipo tinha um único CTA dourado, "Garantir minha vaga", a voz de venda de ingresso. A V1 não
vende ingresso: é um RSVP gratuito. O CTA vira um **par**, e **"Não vou" é uma resposta gravada**. A
organização precisa distinguir "recusou" de "nunca respondeu": quem recusou não precisa de lembrete,
e quem não respondeu talvez precise. Um único "Confirmar presença" liga/desliga misturaria um "não"
explícito com uma mudança de ideia. Por isso as duas opções têm o **mesmo peso visual**: superfície
`bg-card` + um `Check` 16 da marca na selecionada, nunca um botão cheio de um lado e fantasma do
outro. O RSVP fecha no início do evento; depois dele sobra o check-in (D-204).

*A decidir:* o par lê como uma pergunta com duas respostas iguais, ou "Não vou" parece a opção
"errada"?

### (b) O código digitado substitui o QR e o leitor, dentro do mesmo ingresso (D-208)

O ingresso cartão de embarque fica inteiro: capa, a linha Data / Horário / Local, o picote. **O QR, o
pseudo-QR, o leitor de câmera e o divisor "ou" saem** (V2-EVENT-01). No lugar, um **código curto do
local** (4 caracteres de um alfabeto sem ambiguidade, ex.: `K7QM`) que a organização diz em voz alta
ou escreve num quadro, e que o membro digita na janela de 1 h antes do início até o fim (D-209).

O porquê: **"Presente" precisa querer dizer "esteve lá"**, e não "tocou num botão em casa". Um botão
de check-in sem código faria da presença uma alegação. O campo de código que o protótipo já tinha
vira o conteúdo principal, sem layout novo. No evento online não há código: tocar em `Entrar` dentro
da janela é o check-in (D-210).

*A decidir:* o código é o conteúdo principal do ingresso, e cada estado sem formulário (ainda não
abriu, encerrado, cancelado) lê como estado do evento, e não como formulário quebrado?

### (c) Os extras do protótipo que saem, e "Abrir no Maps" no lugar do mapa (D-203)

Saem da V1: o **mapa incorporado** (`EventMap`), lugares próximos e Airbnb, `typeLabel`, vagas /
"Últimas N vagas", ingresso / pagamento, certificado / horas, programação, "Bom saber", fotos,
`/my-events` e `/event-photos` (PROTOTYPE.md do-not-port e V2).

O mapa sai por dois motivos. O iframe do Google sem chave é uma URL de incorporação não oficial que
exige uma exceção `frame-src` na CSP. E ele manda o IP de todo visitante ao Google ao abrir a página
(LGPD). Fica o endereço em texto e **um link "Abrir no Maps"** (`outline`) que abre o app de mapas do
aparelho. Nenhum iframe em lugar nenhum (UI-D-205).

### (d) Os trilhos viram chips + uma grade paginável, e a regra da pílula (UI-D-200 / UI-D-201)

Trilho horizontal não pagina, e "Passados" cresce para sempre. A tela vira **dois chips-link**
("Próximos" padrão, "Passados") e uma **grade** do mesmo cartaz 4/5. Ela tem 1 coluna no celular,
porque 2 colunas em 320px dariam 138px por cartaz, e 2 colunas a partir de `sm` (~318px, perto do
`w-64` de vocês). A pílula do canto passa a dizer **uma coisa**, na ordem `Cancelado` → `Presente` →
`Você vai` → data relativa ("Hoje", "Amanhã", "Em 3 dias", "Agora", "Encerrado"). **A data absoluta
fica sempre no sobretítulo**, onde antes estava o `typeLabel`. A contagem regressiva de vocês
("Faltam N dias", "É hoje!") sobrevive como a forma relativa da pílula e no sobretítulo do herói.

*A decidir:* a pílula e o sobretítulo juntos dizem cada fato uma vez só? E um cartaz cancelado lê
como cancelado à distância da lista, sem esmaecer o título?

### (e) A sinalização aberta do checker: "Descartar"

O `gsd-ui-checker` aprovou o UI-SPEC com uma sinalização não bloqueante: o botão de confirmar do
diálogo de descarte é a palavra solta **"Descartar"** (`events.confirm.discard.confirm`). A revisão
pode fechar isso trocando por **"Descartar evento"** (criar) / **"Descartar alterações"** (editar), o
que espelha os títulos, ou mantendo "Descartar". O desenho mostra a versão atual do contrato.

### (f) A dica de fuso lê "Horário Padrão de Brasília"

O formulário mostra sempre "Fuso horário do evento: {zone}", porque o aparelho do admin pode não
estar no fuso do tenant e as horas são digitadas no relógio de parede do tenant. O UI-SPEC deu como
exemplo "Horário de Brasília", mas o `Intl` do Node 24 (`timeZoneName: 'longGeneric'`) imprime
**"Horário Padrão de Brasília"** (correção da pesquisa, `06-RESEARCH.md` §Pattern 2). O desenho usa o
texto que o produto vai de fato mostrar. Trocar a frase exigiria um mapa próprio de nomes de fuso.

### Dois achados do próprio desenho, para a revisão fechar

Desenhar em 320px e 390px mostrou dois apertos que o UI-SPEC não previu:

1. **O par da agenda em 320px.** Dois `Button outline md` com ícone 16 ("Google Agenda" / "Arquivo
   .ics") não cabem na meia largura de 128px, embora a linha E06 do UI-SPEC afirme que cabem.
   Opções baratas: empilhar abaixo de `sm`, ou tirar o ícone abaixo de `sm`.
2. **A célula "Data" do ingresso.** Com o formato do contrato ("sáb., 12 de out.") ela trunca já em
   390px, porque a célula tem ~110px a 14/700. O protótipo tinha o mesmo aperto. Opção barata: a
   célula usar a data sem o dia da semana ("12 de out.").

## Decisions already fixed upstream

Já decididas em `06-CONTEXT.md`, `06-UI-SPEC.md` e `06-RESEARCH.md` e **fora de revisão**. Estão
aqui para o desenho ser lido com elas em mente, não para serem re-litigadas:

- **D-200** — dois chips com consultas próprias; Próximos pelo início mais próximo, Passados pelo
  mais recente; um evento em andamento fica em Próximos até terminar.
- **D-201** — cancelado fica no lugar, com a pílula; RSVP, check-in e `Entrar` desabilitados;
  ninguém é avisado na V1.
- **D-202** — o cartão do Início mostra o próximo evento do tenant e vira atalho de check-in na
  janela; some quando não há evento.
- **D-203** — endereço em texto + "Abrir no Maps"; sem mapa incorporado (mensagem c).
- **D-204** — RSVP aberto até o início; depois, só check-in; check-in sem "Vou" é walk-in.
- **D-205** — o par gravado "Vou" / "Não vou" (mensagem a).
- **D-206** — membros veem só a contagem, "N confirmados"; nenhuma pilha de avatares.
- **D-207** — o link online depende da resposta e da janela; a URL crua nunca chega ao membro.
- **D-208** — check-in presencial exige o código do local (mensagem b).
- **D-209** — a janela é fixa, de 1 h antes do início até o fim; sem campo no formulário.
- **D-210** — no online, tocar em `Entrar` é o check-in.
- **D-211** — `.ics` + link do Google Agenda; o online leva `/entrar`, nunca a URL crua.
- **D-212** — "Criar evento" na linha do título; sem FAB; sem modo "Evento" em `/criar`.
- **D-213** — o término é obrigatório e vem preenchido com início + 2 h.
- **D-214** — tudo continua editável depois das respostas; cancelar é reversível até o início com
  "Reativar"; não existe excluir.
- **D-215** — `Participantes` só para a organização, com três chips contados e o código no topo.
- **UI-D-205** — **nenhum iframe e nenhum mapa estático** em nenhuma tela.
- **UI-D-200..UI-D-217** — as demais decisões visuais do UI-SPEC, das quais este desenho é a
  materialização.

## How to review

1. Abra `index.html` no navegador. Troque o **tema** e pelo menos **duas marcas** nos presets (o
   Amarelo mostra a tinta escura derivada). Tudo que é da marca recolore; cartões, bordas, contagens,
   nomes, ícones da grade de infos e o código de check-in continuam neutros.
2. **`/eventos`** — os chips substituem os trilhos? A pílula diz uma coisa só, com a data no
   sobretítulo? Um cancelado lê à distância da lista sem esmaecer o título?
3. **O par "Vou" / "Não vou"** — as duas respostas têm o mesmo peso? Percorra a grade da zona de
   ação: **nenhuma linha mostra dois botões preenchidos da marca**.
4. **O ingresso** — o código é o conteúdo principal? Cada estado de recusa lê como estado do
   evento?
5. **Online** — nenhuma URL crua aparece; `Entrar` é `outline` antes da janela e da marca dentro
   dela; cada recusa diz o motivo.
6. **Início** — o cartão cabe entre os stories e o feed sem empurrar o feed para baixo da dobra, e o
   modo check-in é um toque óbvio?
7. **Participantes** — o código vem primeiro, grande o bastante para ler em voz alta na porta, e um
   walk-in se distingue num relance?
8. **As mensagens acima** — responda (a), (b), (d), (e), os dois achados, e confirme (c) e (f).
9. **Texto** — sinalize qualquer palavra a mudar; ela cai em `apps/web/messages/pt-BR/events.json`.

Fora do escopo desta revisão: o cartaz, o herói, a grade de infos e o ingresso em si. São `[proto]`,
portados sem redesenho, e aparecem aqui como contexto ao redor das peças revisadas e dos três
deltas.

## Recording the outcome

**Esta revisão é o portão, não uma formalidade.** Enquanto o frontmatter deste arquivo disser
`approved: false`, **as seis tarefas que codam uma superfície sem protótipo ficam bloqueadas**:

- 06-03 Tarefa 3 (o par RSVP)
- 06-04 Tarefa 2 (o formulário)
- 06-05 Tarefa 2 (a entrada do código)
- 06-06 Tarefa 2 (a variante online)
- 06-07 Tarefa 2 (Participantes)
- 06-08 Tarefa 2 (o cartão do Início)

Cada uma carrega um `precondition` que afirma
`grep -q '^approved: true' .planning/sketches/*-phase-06-designed-screens/README.md` e que para
enquanto este arquivo disser `false`. As tarefas que dependem delas (06-04 Tarefa 3, 06-09) esperam
junto. Por desenho, a Fase 6 para depois das duas primeiras tarefas de 06-03.

`workflow.human_verify_mode` é `end-of-phase`, então isto não sobe como checkpoint no meio da
execução: o orquestrador apresenta este desenho para revisão.

**O registro é uma edição do usuário, não do agente.** Para aprovar, cole no frontmatter deste
arquivo, substituindo os valores pendentes:

- `status: approved`
- `approved: true`
- `approved_by: <seu nome>`
- `approved_at: <AAAA-MM-DD>`
- `approval_kind: provisional` (product owner) ou `designer`

(Estas linhas ficam aqui como lista de propósito: o portão procura `approved: true` no início de uma
linha, e só a linha do frontmatter pode satisfazê-lo.)

Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false` (e
`status: changes-requested`). O desenho é revisado e a revisão se repete. Cada item vira uma seção
"Design review deltas" em `06-UI-SPEC.md`.

Seguindo o precedente de 02-04, 04-02 e 05-02, **uma aprovação provisória do product owner já
desbloqueia a codificação**; deltas posteriores do designer são um passe de polimento, não um
bloqueio. A coluna Winner da linha 006 em `../MANIFEST.md` só é atualizada se você pedir.
