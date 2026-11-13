---
sketch: 022-phase-10.2-designed-screens
name: phase-10.2-designed-screens
phase: "10.2"
question: "As telas novas da abertura das inscrições do evento — o cartão e a capa com a etiqueta Em breve e a contagem curta, a zona da página com os três blocos de dias, horas e minutos, a data exata e a troca sozinha para Comprar ingresso, as variantes da contagem, a contagem até o evento para quem já tem presença, o campo Abertura das inscrições na seção Ingresso do formulário com os estados bloqueado, data passada e erros, as marcas Antes da abertura em Participantes e em Eventos recentes e a nota do leitor de tela — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - cartao-em-breve-sem-preco
  - cartao-em-breve-com-preco
  - cartao-em-breve-menos-de-um-minuto
  - cartao-em-breve-abrindo-agora
  - cartao-pago-apos-abertura
  - cartao-inscrito-contagem-evento
  - cartao-em-breve-320
  - heroi-em-breve
  - heroi-inscrito-contagem-evento
  - zona-em-breve-com-preco
  - zona-em-breve-sem-preco
  - zona-em-breve-online-dica
  - zona-em-breve-fuso-longo
  - zona-em-breve-320
  - zona-em-breve-abrindo-agora
  - zona-troca-aberta
  - zona-venda-indisponivel-antes-da-abertura
  - contador-variantes
  - zona-em-breve-dias-horas-minutos
  - zona-em-breve-so-horas-minutos
  - zona-em-breve-so-minutos
  - zona-em-breve-menos-de-um-minuto
  - zona-em-breve-mais-de-cem-dias
  - zona-em-breve-sem-semente
  - presenca-contagem-evento-dias
  - presenca-contagem-evento-horas
  - presenca-contagem-evento-minutos
  - presenca-antecipada-confirmada
  - presenca-ao-vivo
  - meus-eventos-cartao-contagem
  - form-abertura-vazio
  - form-abertura-preenchido
  - form-abertura-data-passada
  - form-abertura-erro-incompleto
  - form-abertura-erro-depois-do-inicio
  - form-abertura-bloqueado
  - form-abertura-bloqueado-sem-data
  - form-abertura-desligar-aviso
  - form-abertura-falha-trava-obsoleta
  - form-abertura-320
  - participantes-antes-da-abertura
  - eventos-recentes-marcador
  - contador-leitor-de-tela
status: pending
approved: false
approved_by: null
approved_at: null
approval_kind: null
changes_requested: []
winner: null
tags: [phase-10.2, design-review, D-33, D-365, D-417, UI-04, event-opening, countdown, kiwify, paid-events]
---

# Sketch 022: Fase 10.2 — Abertura das inscrições do evento com contagem regressiva (portão de revisão D-33 / D-365 / D-417 / UI-04)

## Design Question

Num evento com ingresso pago (Fase 10.1), o admin passa a poder **marcar quando as inscrições abrem**. Antes dessa
hora o evento mostra “Em breve” com uma contagem regressiva e **sem link de compra** (o servidor é quem bloqueia, o
desenho só reflete); na hora, a zona da página troca sozinha para “Comprar ingresso”. Quem já tem presença num
evento pago vê, no lugar de “Faltam N dias”, os dias, horas e minutos até o evento. O protótipo do time de design
não tem a etiqueta “Em breve”, a contagem curta do cartão, a zona com três blocos, o campo “Abertura das inscrições”
do formulário, a contagem de quem tem presença nem as marcas “Antes da abertura”, então essas superfícies são
**[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e revisadas **antes de codar** (UI-04).
São oito grupos:

1. o **cartão `Em breve` da lista** (UI-D-782): a etiqueta com e sem preço, a nota “Abre em …”, menos de um minuto,
   “Abrindo agora”, a volta para “Pago”, o espectador que já está dentro e o 320px;
2. a **capa** (UI-D-783, UI-D-788): a etiqueta na capa e a contagem até o evento de quem já tem presença;
3. a **zona `Em breve` do detalhe** (UI-D-784, UI-D-785): os três blocos, a data exata, a linha do fuso, o preço, a
   dica do online, **sem botão**, a troca sozinha para “Comprar ingresso” e a precedência com “Venda indisponível”;
4. as **variantes da contagem** (UI-D-785): dias, horas e minutos; só horas e minutos; só minutos; menos de um
   minuto; mais de cem dias; e o estado sem semente de tempo;
5. a **contagem de quem tem presença** (UI-D-788, UI-D-789): em dias, em horas, em minutos, a presença paga antes da
   abertura, a passagem ao vivo e o cartão de “Meus eventos”;
6. o **campo “Abertura das inscrições” no formulário** (UI-D-790, UI-D-791): vazio, preenchido, data passada, erros,
   bloqueado com “N ingressos vendidos”, o aviso ao desligar o ingresso, a falha por trava obsoleta e o 320px;
7. **Participantes** e **Eventos recentes** (UI-D-792): a marca “Antes da abertura”, inclusive com quatro marcas
   numa linha só;
8. a **nota do leitor de tela** (UI-D-787): o que fica escondido, o que é `role="timer"` e as frases educadas.

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos, raios de
12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a marca do
tenant —, em claro e escuro, sob qualquer marca, em 320 e 390px? A Fase 10.2 não declara token, cor, fonte, tamanho
nem dependência nova; o desenho só combina as primitivas já entregues.

## How to View

```
open .planning/sketches/022-phase-10.2-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre offline. É
um artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou referencia. Os tokens são
os de `packages/ui/src/styles/tokens.css`.

Controles no topo (chrome do mockup, fora do produto): alternar tema claro e escuro, três marcas de tenant e a
largura 390 ou 320px. Cada quadro leva o seu nome em `data-frame` e na etiqueta. São **43 quadros** e a lista
`screens:` do topo deste arquivo é igual aos quadros desenhados, na ordem da página. Três quadros mostram o
comportamento em 320px (`cartao-em-breve-320`, `zona-em-breve-320` e `form-abertura-320`). As datas do desenho seguem uma linha
do tempo de exemplo única: evento no sábado, 28 de nov., 19:00; abertura em 20 nov, 10:00; agora em 18 nov, 05:47
(os quadros de “2 d 4 h 13 min”). Os dígitos da contagem são valores de exemplo, não dados ligados. Nenhuma tela
de membro nomeia o gateway. Os nomes, e-mails (domínio reservado `.invalid`) e valores são exemplos.

## O que se pede ao time de design

As perguntas do UI-SPEC (seção “Sketch gate”), uma por grupo:

- **(a)** A etiqueta “Em breve” (com o relógio) e a nota curta “Abre em …” do cartão lêem bem com e sem preço, ao
  lado da data, sem “Últimas N vagas”, e a volta para “Pago” na abertura fica clara? Ver `cartao-em-breve-sem-preco`,
  `cartao-em-breve-com-preco`, `cartao-em-breve-menos-de-um-minuto`, `cartao-pago-apos-abertura`.
- **(b)** A etiqueta da capa e a linha de cima de quem já tem presença (a contagem até o evento no lugar de “Faltam N
  dias”) estão legíveis? Ver `heroi-em-breve`, `heroi-inscrito-contagem-evento`, `cartao-inscrito-contagem-evento`.
- **(c)** A zona com três blocos de contagem, a abertura exata, a linha do fuso e o preço — **sem botão** — e a troca
  sozinha para “Comprar ingresso” são o que o produto quer? Ver `zona-em-breve-com-preco`, `zona-em-breve-sem-preco`,
  `zona-troca-aberta`, `zona-venda-indisponivel-antes-da-abertura`.
- **(d)** As variantes da contagem (unidade zero some, menos de um minuto, mais de cem dias, sem semente) estão
  certas? Ver `contador-variantes`, `zona-em-breve-so-horas-minutos`, `zona-em-breve-menos-de-um-minuto`,
  `zona-em-breve-sem-semente`.
- **(e)** A contagem de quem tem presença, que **corre pela janela de check-in até o início** em vez de passar para
  “É hoje!” (A-UI-15), e a presença paga antes da abertura leem bem? Ver `presenca-contagem-evento-dias`,
  `presenca-contagem-evento-minutos`, `presenca-antecipada-confirmada`, `presenca-ao-vivo`.
- **(f)** O campo “Abertura das inscrições” na seção Ingresso, com “Data” e “Hora”, “Limpar abertura”, o aviso de
  data passada, o bloqueio com “N ingressos vendidos” e o aviso ao desligar o ingresso, é o que o admin precisa?
  Ver `form-abertura-vazio`, `form-abertura-preenchido`, `form-abertura-data-passada`, `form-abertura-bloqueado`,
  `form-abertura-desligar-aviso`.
- **(g)** A marca neutra “Antes da abertura” em Participantes (inclusive quatro marcas numa linha) e em Eventos
  recentes diz ao admin o que ele precisa saber, sem virar alarme? Ver `participantes-antes-da-abertura`,
  `eventos-recentes-marcador`.
- **(h)** A nota do leitor de tela (blocos escondidos, `role="timer"`, três frases por limite mais a abertura) é a
  que o produto quer? Ver `contador-leitor-de-tela`.

Comece por `zona-em-breve-com-preco` e `presenca-contagem-evento-minutos`: se esses dois quadros estão certos, o
resto segue as mesmas primitivas.

## Os padrões do pesquisador que o product owner pode derrubar (A-UI-1..A-UI-21)

O UI-SPEC foi escrito sem poder perguntar nada e registrou vinte e um padrões na seção “Defaults chosen”. **São
padrões do pesquisador de UI, e o Igor pode derrubar qualquer um nesta revisão.** O desenho mostra o padrão; a
coluna da direita é o custo de mudar.

### Decididos nesta revisão (olhe primeiro)

| # | Padrão desenhado | Alternativa | Custo de mudar |
|---|------------------|-------------|----------------|
| **A-UI-15** (item aberto contra o D-790) | A contagem de quem tem presença **corre pela janela de check-in** até o início; o “É hoje!” **não** é usado para o titular de um evento pago; no início passa para “Acontecendo agora”. O texto do D-790 diz “passa para a janela de check-in, Ao vivo, Hoje”, e este desenho **se afasta da letra**. | Passar para “É hoje!” no dia do evento e para o banner de check-in na janela, parando a contagem antes. | Um ramo em `heroOverline` e em `eventCardNote`. |
| **A-UI-6** | Os números da contagem usam o papel **Título 24/700** existente, `tabular-nums`, uma exceção pontual a “um Título por tela” (são números, não um título). | Números 16/700 (menores, sem exceção). | Uma classe; a altura da célula. |
| **A-UI-7** | A zona `Em breve` **não tem botão**, nem um botão desabilitado de marca, e nenhum preenchimento de marca (D-786), com a dica “Quando abrir, o botão Comprar ingresso aparece aqui sozinho.” | Um botão “Em breve” desabilitado de marca, como o “Esgotado”. | Um ramo de componente; põe um preenchimento de marca num estado fechado. |
| **A-UI-8** | O **rótulo do fuso do tenant sempre aparece** na zona (“Fuso horário: {zona}”), quebrando de linha quando longo, nunca abreviado. | Mostrar só quando o fuso do aparelho difere, ou tirar. | Uma linha e uma chave de catálogo. |
| **A-UI-3** | O **cartão segue só a abertura** (não enxerga o módulo nem o gateway); a **página** aplica a precedência completa, então o cartão pode dizer `Em breve` enquanto a página diz `Venda indisponível` (módulo desligado). | Pôr a marca de indisponível no payload da lista para o cartão voltar a `Pago`. | Um campo no modelo de leitura e um ramo de visão. |
| **A-UI-19** | `Antes da abertura` é uma pílula **neutra**, logo depois de `Pago`, só em presenças de origem paga, e a mesma pílula na linha de Eventos recentes. | Tom `warning` (mais atenção); ou uma linha de texto em vez de pílula. | Uma propriedade de tom; uma linha. |

### Os demais padrões

| # | Padrão desenhado | Alternativa | Custo de mudar |
|---|------------------|-------------|----------------|
| **A-UI-1** | A etiqueta `Em breve` leva um relógio `Clock` 10 ao lado da palavra (UI-D-782). | Só a palavra, como o `Pago` sem preço. | Um glifo. |
| **A-UI-2** | Enquanto `Em breve`, a nota do cartão é `[preço ·] Abre em …` e o “Últimas N vagas” **não** aparece (ninguém pode comprar ainda). | Manter a nota de vagas ao lado da contagem. | Um ramo em `eventCardNote`. |
| **A-UI-4** | O tempo restante é **truncado para minutos**; cada contagem rearma **um** `setTimeout` para **a sua própria próxima mudança**; sem segundos em lugar nenhum; os últimos 59 s dizem “Menos de 1 min”. | Arredondar para cima; bater no minuto do relógio; mostrar segundos no último minuto. | O formatador e o ajudante do temporizador. |
| **A-UI-5** | **Zeros do meio também somem** (1 d 0 h 5 min vira `1 d 5 min`), a leitura literal do D-787. Na página, as células simplesmente omitem a unidade zero. | Esconder só os zeros à esquerda e manter os do meio (`1 d 0 h 5 min`, três células fixas). | O formatador e alguns quadros. |
| **A-UI-9** | `EventPoster.note` e a linha de cima do `EventHero` **alargam** de `string` para um **nó pronto**, para a contagem ao vivo caber num módulo só de props. | Uma fatia por render-prop, ou o host embrulha o cartaz. | Um tipo em cada interface de módulo. |
| **A-UI-10** | O singular **“Falta”** só aparece quando o texto todo é **uma unidade igual a 1** (“Falta 1 h”, “Falta 1 min”); o resto é “Faltam”. | Sempre “Faltam”; ou sempre a forma abreviada sem verbo. | Um `select` ICU. |
| **A-UI-11** | Cada contagem tem **um** temporizador; o planejador pode compartilhar um agendador se uma galeria tiver muitos cartões `Em breve`. | Um único relógio de minuto compartilhado para a página toda. | Um hook e os seus testes. |
| **A-UI-12** | Voltar a uma aba escondida por **mais de 60 s** dispara um `router.refresh()` para reajustar o relógio (também em `pageshow`). | Sem refresh; ou outro limite. | Uma constante. |
| **A-UI-13** | Com **nenhuma semente** na resposta, nenhuma contagem é desenhada (só a linha estática da abertura); o relógio do aparelho nunca é reserva. | Cair no `Date.now()` com a nota “horário aproximado”. | Um ramo e uma regra de confiança (UI-D-796). |
| **A-UI-14** | Tecnologia assistiva: blocos `aria-hidden`, um `role="timer"` escondido fora do invólucro ao vivo, **três** frases educadas por limite de unidade mais a abertura. | Anunciar só a abertura; ou também cada hora. | Um nó escondido e três textos. |
| **A-UI-16** | O anúncio “As inscrições abriram.” só é falado **quando o cliente viu a troca**; “Abrindo agora” se mantém pela cadeia de novas tentativas já entregue, sem texto de erro. | Um toast na troca; ou uma linha de erro quando a cadeia acabar. | Uma marca e um texto. |
| **A-UI-17** | O campo do formulário é um `fieldset` com a legenda “Abertura das inscrições”, o par “Data” / “Hora”, um “Limpar abertura” discreto (só quando há valor), um auxílio de “preenchido” e uma linha `Info` de data passada. | Um único `datetime-local`; sem botão de limpar. | Um tipo de campo; limpar no iOS fica mais difícil. |
| **A-UI-18** | Desligar o ingresso com uma data mostra uma **linha de aviso** (sem diálogo); o valor digitado sobrevive ao liga e desliga até salvar. | Um diálogo de confirmação ao salvar; ou limpar o valor no instante em que o interruptor desliga. | Um diálogo ou uma regra de estado. |
| **A-UI-20** | A abertura exata lê “Abertura: 20 nov, 10:00” (sem dia da semana), com o ano só para outro ano local do tenant. | Com o dia da semana (“qui., 20 nov”), como as datas do evento. | Uma opção do `Intl`. |
| **A-UI-21** | O admin vê a **mesma zona `Em breve`** que o membro (sem linha só de admin na página); a visão do admin sobre a data é o formulário. | Uma linha no cartão de gestão: “Abertura das inscrições: …”. | Uma linha do cartão de gestão. |

### Suposições do planejamento que o Igor confirma na mesma sentada

Estas não são padrões de desenho, são regras que o código vai seguir ao pé da letra. Aprovar o sketch as confirma;
o Igor pode mudar qualquer uma:

- **A-10.2-CONF**: a marca “Antes da abertura” sai de um **instante de confirmação dedicado**, escrito pela liberação
  do ingresso nos três caminhos de gravação, e **não** de `responded_at`, porque a promoção de um “Vou” ou de uma
  cortesia já existentes nunca toca em `responded_at` (quem tinha “Vou” e paga depois da abertura seria marcado como
  antecipado por engano). Alternativa: usar `responded_at`, o que erra nesse caso e na liberação manual.
- **A-10.2-SALE-READY**: o detalhe do evento carrega **um booleano opcional a mais** (a venda está pronta: produto
  vinculado, modo gateway e link `https:`, ignorando o relógio), para a página colocar `Venda indisponível` **antes**
  de `Em breve`. Alternativa: sem o booleano, a página mostraria uma contagem num evento cujo módulo está desligado.
- **A-10.2-SERVER-NOW**: a semente da contagem é o **instante do banco** da mesma transação que decidiu o link
  (`now()` da mesma consulta), e a web decide `Em breve` só pela abertura contra essa semente, nunca pelo relógio do
  servidor da web nem do aparelho. Alternativa: o relógio da web, o que abre uma janela com “Comprar ingresso” sem
  link ou com `Em breve` depois que o banco já abriu.
- **A-10.2-OMIT**: o formulário **omite** a chave da abertura enquanto o admin não digitou nem limpou nada, para uma
  web que esteja à frente da API continuar salvando eventos. Alternativa: sempre enviar a chave, o que quebra a
  gravação quando a API ainda não conhece o campo.
- **A-10.2-REFUND-LIFT**: uma venda **totalmente reembolsada levanta a trava** da data, e um ingresso reembolsado
  que já fez check-in **mantém** a trava (a regra de `app.event_ticket_lock` já entregue). Alternativa: qualquer
  venda paga trava para sempre, mesmo reembolsada.
- **A-10.2-STALE-DATE**: uma data guardada num evento cuja ligação com o produto falhou é **invisível e nunca vende**
  (sem produto vinculado não há `Em breve` nem contagem). Alternativa: mostrar o `Em breve` mesmo assim.
- **A-10.2-NATIVE**: o plano 13-18 **não cobre** a zona “Comprar ingresso” do evento; é uma **nota para a Fase 13**
  (decidir lá), e nada nativo se constrói aqui.

## Textos de exemplo no desenho

O texto vem do Copywriting Contract do UI-SPEC onde ele existe. O desenho também mostra, só como **contexto das
telas já entregues** e marcados como exemplo, nomes de demonstração de eventos, valores em reais e as etiquetas
`Pago`, “Participantes” e “Eventos recentes” da Fase 10.1. **Pergunta ao time de design:** algum desses exemplos
mascara um problema de largura ou de quebra de linha que um preço de oito dígitos, uma contagem de cem dias ou um
rótulo de fuso comprido causaria em 320px? (Ver `cartao-em-breve-320`, `zona-em-breve-fuso-longo`,
`zona-em-breve-320`, `form-abertura-320`.)

## Decisões travadas a montante (não se rediscutem aqui)

D-780 a D-794 do `10.2-CONTEXT.md` e UI-D-780 a UI-D-796 do `10.2-UI-SPEC.md` (as decisões visuais) estão fixadas.
Esta revisão só pergunta se o **desenho** as cumpre, e confirma ou derruba os padrões e as suposições acima.

## Como revisar e como o resultado é registrado

1. Abra o `index.html`, alterne tema claro e escuro, troque entre as marcas e a largura 320px, e confira os quadros
   de 320px.
2. Comece por `zona-em-breve-com-preco` e `presenca-contagem-evento-minutos`.
3. **Quem registra o resultado é o Igor**, editando o frontmatter deste arquivo. Para aprovar, troque os valores
   pendentes por estes:

       status: approved
       approved: true
       approved_by: <seu nome>
       approved_at: <AAAA-MM-DD>
       approval_kind: provisional

   Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false`; o desenho é então revisado e a
   revisão se repete. Se o Igor dispensar o portão, ele registra a dispensa como decisão no `10.2-CONTEXT.md`, e os
   planos 12 a 16 largam a guarda; o mínimo que ainda vale olhar são os dois quadros acima.

Enquanto este arquivo disser `approved: false`, **todas as tarefas de tela da Fase 10.2 (planos 12 a 16) param na
precondição**. Os planos de banco, contrato, API, modelo de leitura, formatador, modelo de visão e hook (01, 04 a
11) não dependem desta aprovação e seguem.
