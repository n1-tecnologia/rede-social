---
sketch: 021-phase-10.1-designed-screens
name: phase-10.1-designed-screens
phase: "10.1"
question: "As telas novas do ingresso pago do evento — a seção Ingresso do formulário com os estados bloqueado, módulo desligado e não conectado, a etiqueta Pago e o preço no cartão e na capa, a zona de ação com Comprar ingresso, Esgotado, Vendas encerradas e Venda indisponível, o bloco Presença confirmada e a troca ao vivo, as portas fechadas do Entrar e do check-in, as marcas de origem em Participantes com a folha Liberar presença, as linhas de ingresso em Eventos recentes com a liberação manual e a linha do sino — leem como a própria linguagem do protótipo, em claro e escuro, sob qualquer marca de tenant, em 320 e 390px?"
screens:
  - form-ingresso-desligado
  - form-ingresso-ligado
  - form-ingresso-nota-existentes
  - form-ingresso-bloqueado
  - form-ingresso-modulo-desligado
  - form-ingresso-nao-conectado
  - form-ingresso-vinculado-indisponivel
  - form-ingresso-assinatura
  - form-ingresso-erros
  - form-ingresso-falha-segunda-gravacao
  - form-ingresso-desligar-nota
  - form-ingresso-320
  - cartao-pago-sem-preco
  - cartao-pago-com-preco
  - cartao-pago-ultimas-vagas
  - cartao-inscrito-sem-etiqueta
  - cartao-pago-320
  - heroi-pago
  - heroi-inscrito-sem-etiqueta
  - zona-comprar-sem-preco
  - zona-comprar-com-preco
  - zona-esgotado
  - zona-vendas-encerradas
  - zona-venda-indisponivel
  - zona-online-dica-link
  - zona-cancelado-vazia
  - zona-comprar-320
  - confirmada-paga
  - confirmada-cortesia
  - confirmada-anterior
  - confirmada-cancelado-paga
  - confirmada-checkin-reembolsada
  - reembolsado-sem-presenca
  - desistir-anterior-dialogo
  - troca-ao-vivo-antes
  - troca-ao-vivo-depois
  - confirmada-320
  - entrar-ingresso-com-compra
  - entrar-ingresso-sem-compra
  - checkin-pago-com-compra
  - checkin-pago-sem-compra
  - recusa-ingresso-toast
  - checkin-pago-320
  - participantes-marcas
  - participantes-tres-marcas
  - participantes-liberar-botao
  - liberar-folha-aviso
  - liberar-folha-resultados
  - liberar-folha-ja-inscrito
  - liberar-folha-vazia
  - liberar-folha-erro
  - liberar-confirma
  - nao-vao-liberar-linha
  - cortesia-remover-linha
  - cortesia-remover-confirma
  - acima-do-limite-aviso
  - acima-do-limite-pilula-gestao
  - participantes-320
  - pagamentos-ingresso-aplicado
  - pagamentos-ingresso-sem-conta
  - pagamentos-ingresso-evento-encerrado
  - pagamentos-ingresso-evento-cancelado
  - pagamentos-ingresso-ignorado
  - pagamentos-ingresso-reembolso-removida
  - pagamentos-ingresso-reembolso-mantida
  - pagamentos-ingresso-acima-do-limite
  - pagamentos-ingresso-liberar-dialogo
  - pagamentos-ingresso-320
  - sino-presenca-confirmada
  - sino-presenca-removida-conteudo
  - push-presenca-confirmada
status: approved
approved: true
approved_by: Igor (recorded by Claude on Igor's instruction, "pode mudar voce mesmo", 2026-11-13)
approved_at: 2026-11-13
approval_kind: provisional
changes_requested: []
winner: null
tags: [phase-10.1, design-review, D-33, D-365, D-417, UI-04, event-tickets, kiwify, paid-events]
---

# Sketch 021: Fase 10.1 — Ingresso pago do evento pela Kiwify (portão de revisão D-33 / D-365 / D-417 / UI-04)

## Design Question

Com o módulo de pagamentos conectado (Fase 09.1), a Fase 10.1 deixa o admin **cobrar ingresso** num evento: o evento
ganha um produto da Kiwify, o membro compra e a presença nasce da compra, sem passar pelo “Vou”. O protótipo do time
de design não tem a seção Ingresso do formulário, a etiqueta Pago, o preço no cartão e na capa, a zona de ação com
“Comprar ingresso”, o bloco “Presença confirmada”, as portas fechadas do Entrar e do check-in, as marcas de origem
em Participantes, a folha “Liberar presença”, as linhas de ingresso em “Eventos recentes” nem a linha do sino, então
essas superfícies são **[designed]** e, pelas regras D-33, D-365 e D-417, precisam ser desenhadas e revisadas
**antes de codar** (UI-04). São oito grupos:

1. a **seção Ingresso do formulário do evento**: o interruptor “Cobrar ingresso” e os três campos, a nota de
   presenças existentes, o aviso de bloqueio com “N ingressos vendidos”, módulo desligado, não conectado, vinculado
   mas desligado, o aviso de produto recorrente, os erros de campo, a falha na segunda gravação e a nota ao desligar
   (UI-D-741 a UI-D-743);
2. o **cartão e a capa de um evento pago**: a etiqueta “Pago”, com e sem preço, ao lado da data e de “Últimas N
   vagas”, e o espectador que já está dentro, sem etiqueta (UI-D-744, UI-D-745);
3. a **zona de ação do detalhe** para o membro sem presença: “Comprar ingresso” com e sem preço, “Esgotado”,
   “Vendas encerradas”, “Venda indisponível”, a dica do online, o evento cancelado, com as linhas de dica
   (UI-D-746, UI-D-747);
4. a **Presença confirmada**: as variantes paga, cortesia e anterior ao ingresso, o aviso de cancelado com presença
   paga, as linhas de reembolso, o diálogo de desistir da presença anterior e a troca ao vivo antes e depois
   (UI-D-748 a UI-D-750);
5. as **portas fechadas**: a tela de recusa do Entrar (`ingresso`), com e sem “Comprar ingresso”, a seção paga do
   check-in e o toast de aba antiga (UI-D-751 a UI-D-753);
6. **Participantes**: as marcas de origem nas linhas (inclusive três numa linha só), o botão “Liberar presença” da
   barra, a folha de liberação (aviso, resultados, “Já inscrito”, vazio, erro), a ação da linha Não vão, os dois
   diálogos de confirmação, a remoção de cortesia, o aviso de acima do limite e a pílula do cartão de gestão
   (UI-D-754 a UI-D-757);
7. **Pagamentos · Eventos recentes**: as linhas de ingresso em cada estado (“Aplicado”, “Sem conta” com “Liberar
   manualmente”, “Evento encerrado”, “Evento cancelado”, “Ignorado”, reembolso com “Presença removida” e “Presença
   mantida”, acima do limite) e o diálogo de liberação manual (UI-D-758, UI-D-759);
8. a **linha do sino** “Presença confirmada em {evento}” e o seu push (UI-D-760).

A pergunta de design: tudo isso lê como a linguagem do protótipo — fundo `#f5f7fb` com cartões brancos, raios de
12px, alvos de 44px, a escala 12 / 14 / 16 / 24 com pesos 400 / 700 e **uma** cor de destaque, a marca do
tenant —, em claro e escuro, sob qualquer marca, em 320 e 390px? A Fase 10.1 não declara token, cor, fonte, tamanho
nem dependência nova; o desenho só combina as primitivas já entregues.

## How to View

```
open .planning/sketches/021-phase-10.1-designed-screens/index.html
```

**Um arquivo, zero rede.** Sem build, sem framework, sem script remoto e sem imagem real. O arquivo abre offline. É
um artefato de revisão sob `.planning/`: nenhum código de aplicação o importa, empacota ou referencia. Os tokens são
os de `packages/ui/src/styles/tokens.css`.

Controles no topo (chrome do mockup, fora do produto): alternar tema claro e escuro, três marcas de tenant e a
largura 390 ou 320px. Cada quadro leva o seu nome em `data-frame` e na etiqueta. São **71 quadros** e a lista
`screens:` do topo deste arquivo é igual aos quadros desenhados, na ordem da página. Sete quadros mostram o comportamento
em 320px (`form-ingresso-320`, `cartao-pago-320`, `zona-comprar-320`, `confirmada-320`,
`checkin-pago-320`, `participantes-320`, `pagamentos-ingresso-320`). Nas telas do admin, o campo {gateway} usa o nome
neutro de exemplo “Gateway Exemplo”; nenhuma tela de membro nomeia o gateway. Os nomes, e-mails (domínio reservado
`.invalid`) e valores são exemplos.

## O que se pede ao time de design

As perguntas do UI-SPEC (seção “Sketch gate”), uma por grupo:

- **(a)** A seção Ingresso lê como mais um bloco do formulário, com o interruptor “Cobrar ingresso” e os três
  campos, e os estados bloqueado, módulo desligado, não conectado e vinculado mas desligado ficam claros? Ver
  `form-ingresso-desligado`, `form-ingresso-ligado`, `form-ingresso-bloqueado`, `form-ingresso-nao-conectado`.
- **(b)** A etiqueta “Pago” e a nota de preço na capa ficam legíveis ao lado da data e de “Últimas N vagas”, com e
  sem preço, e o espectador que já está dentro fica sem etiqueta? Ver `cartao-pago-sem-preco`,
  `cartao-pago-com-preco`, `cartao-pago-ultimas-vagas`, `heroi-pago`.
- **(c)** O controle único “Comprar ingresso” e as suas quatro variantes desabilitadas (“Esgotado”, “Vendas
  encerradas”, “Venda indisponível” e o online com a dica) são as que o produto quer, sem estado intermediário
  entre comprar e estar dentro? Ver `zona-comprar-sem-preco`, `zona-comprar-com-preco`, `zona-esgotado`,
  `zona-vendas-encerradas`, `zona-venda-indisponivel`.
- **(d)** “Presença confirmada” nas três variantes (paga, cortesia, anterior ao ingresso) e a troca ao vivo de
  “Comprar ingresso” para o bloco confirmado leem bem, inclusive o reembolso e o cancelado com presença paga? Ver
  `confirmada-paga`, `confirmada-cortesia`, `confirmada-anterior`, `troca-ao-vivo-antes`, `troca-ao-vivo-depois`.
- **(e)** As duas portas fechadas (a recusa do Entrar com `ingresso` e a seção paga do check-in), com e sem o botão
  “Comprar ingresso”, e o toast de aba antiga estão certas? Ver `entrar-ingresso-com-compra`,
  `entrar-ingresso-sem-compra`, `checkin-pago-com-compra`, `recusa-ingresso-toast`.
- **(f)** As marcas de origem, a folha “Liberar presença”, a remoção de cortesia e o aviso de acima do limite são o
  que o admin precisa em Participantes? Ver `participantes-marcas`, `participantes-tres-marcas`,
  `liberar-folha-aviso`, `liberar-folha-resultados`, `cortesia-remover-confirma`, `acima-do-limite-aviso`.
- **(g)** As linhas de ingresso em “Eventos recentes” e o diálogo de liberação manual deixam claro o que aconteceu
  com cada compra e o que o admin pode fazer? Ver `pagamentos-ingresso-aplicado`, `pagamentos-ingresso-sem-conta`,
  `pagamentos-ingresso-reembolso-removida`, `pagamentos-ingresso-liberar-dialogo`.
- **(h)** A linha do sino “Presença confirmada em {evento}” e o push (com o corte por palavra no corpo) seguem as
  linhas de notificação já entregues? Ver `sino-presenca-confirmada`, `sino-presenca-removida-conteudo`,
  `push-presenca-confirmada`.

Comece por `zona-comprar-com-preco` e `participantes-tres-marcas`: se esses dois quadros estão certos, o resto segue
as mesmas primitivas.

## Os padrões do pesquisador que o product owner pode derrubar (A-UI-1..A-UI-14)

O UI-SPEC foi escrito sem poder perguntar nada e registrou catorze padrões na seção “Assumptions and pending
confirmation”. **São padrões do pesquisador de UI, e o Igor pode derrubar qualquer um nesta revisão.** O desenho
mostra o padrão; a coluna da direita é o custo de mudar:

| # | Padrão desenhado | Alternativa | Custo de mudar |
|---|------------------|-------------|----------------|
| **A-UI-1** | A seção Ingresso usa um interruptor **“Cobrar ingresso”** que revela os três campos (UI-D-741), o padrão do interruptor de certificado do passo 2. | Campos sempre visíveis, com leitura de produto opcional. | Um ramo; os erros de campo vazio se movem. |
| **A-UI-2** | A seção fica **no fim do passo 1, depois de “Vagas”** (UI-D-741). | Um terceiro passo “Ingresso”; ou entre “Vagas” e “Quando”. | Mover um bloco; uma aba de passo. |
| **A-UI-3** | O **preço de referência continua editável com o produto bloqueado** (UI-D-742): é só visual e o D-747 trava o produto. | Travar o preço também. | Um `disabled`. |
| **A-UI-4** | Uma presença **anterior ao ingresso** mantém um “Cancelar inscrição” discreto atrás de um diálogo de perigo; paga e cortesia não têm (UI-D-750). O planejador confirma que o banco deixa o membro gravar `going -> not_going` num evento pago (o D-741 recusa só criar `going`). | Tratar como cortesia: sem controle de desistir, “fale com a equipe”. | Um ramo e um diálogo. |
| **A-UI-5** | A **cortesia do admin acima da capacidade é permitida** e marcada “Acima do limite”, espelhando o D-751 (UI-D-755, UI-D-757). | Recusar com o texto “Este evento está lotado.” | Um código de recusa e um toast. |
| **A-UI-6** | “Liberar presença” precisa de uma **folha de busca de membro** (quem nunca respondeu não está em Participantes) mais uma ação por linha no chip Não vão; a folha reaproveita a leitura de Membros do admin (UI-D-755). | Só a ação da linha Não vão. | Tira a porta da barra e a folha; enfraquece o D-743. |
| **A-UI-7** | `?motivo=ingresso` **lê o evento uma vez** para oferecer “Comprar ingresso”; qualquer falha desenha a tela sem o botão (UI-D-751). | Uma tela de texto fixo só com “Ver evento”. | Uma leitura a menos. |
| **A-UI-8** | As **linhas de reembolso** só aparecem quando a leitura traz `viewerRefunded`; sem o sinal, sem linha, e nenhuma lápide é inventada (UI-D-749). | Tirar as duas linhas de reembolso. | Dois textos. |
| **A-UI-9** | **Nenhuma notificação** para cortesia, reembolso, estorno ou pagamento num evento já encerrado; o D-756 nomeia só a aprovação (UI-D-760). | Uma linha do sino para reembolso e para cortesia. | Tipos, texto e um renderizador para cada. |
| **A-UI-10** | O **aviso de produto recorrente** só aparece quando a gravação do vínculo traz a dica; não há pré-checagem (UI-D-742 (e)). | Nunca avisar. | Uma linha. |
| **A-UI-11** | A aba **“Eventos” do Pagamentos mantém o nome**; as linhas de ingresso se distinguem pela linha de produto “Ingresso · {evento}” (UI-D-758). | Renomear a aba para “Entregas” ou “Recebidos”. | Uma edição de catálogo e os nomes do e2e da 09.1. |
| **A-UI-12** | O **Início não desenha nada**: o cartão “Próximo evento” está desmontado desde 2026-10-03 (UI-D-745). | Remontar o cartão com a etiqueta. | Um compositor de hospedagem e seus testes. |
| **A-UI-13** | A marca **“Acima do limite” por linha** é um sinal calculado no servidor pela hora de confirmação; o planejador define a regra (UI-D-757). | Só o aviso da página e a pílula de gestão. | Tira uma pílula e um sinal. |
| **A-UI-14** | Um evento pago cancelado diz ao titular para **perguntar à equipe sobre o reembolso**, em vez de prometer um automático (UI-D-749). | Não dizer nada. | Uma frase. |

### Suposições do planejamento que o Igor confirma na mesma sentada

Estas não são padrões de desenho, são regras que o código vai seguir ao pé da letra. Aprovar o sketch as confirma;
o Igor pode mudar qualquer uma (texto literal dos planos):

- **A-06-PRICE**: salvar o evento com um PUT que **omite** a chave do preço mantém o preço guardado; enviar `null`
  limpa. Alternativa: omitir também limpa, o que obriga todo cliente a reenviar o preço em cada gravação.
- **A10b**: quem tem presença **anterior ao ingresso** e paga mesmo assim vira presença de ingresso, então um
  reembolso a remove. Alternativa: manter a presença antiga e ignorar a compra, o que deixa o reembolso sem efeito.
- **A6**: um **walk-in ou check-in feito antes do vínculo** do ingresso continua valendo. Alternativa: revalidar tudo
  ao vincular, o que pode derrubar presenças já usadas na porta.
- **A8**: a **liberação manual também notifica o membro** (a mesma linha do sino de uma compra aprovada).
  Alternativa: liberar em silêncio, o que faz o membro descobrir sozinho.
- **A-UI-13**: a regra do “Acima do limite” por **hora de confirmação** (quem confirmou depois que a lotação
  encheu). Alternativa: só o aviso da página.
- **A-UI-6**: a folha de liberar presença **reaproveita a busca de Membros do admin** mais uma leitura dos titulares
  de ingresso. Alternativa: só a ação da linha Não vão.
- **A-11-GATEWAY**: quando nenhum nome de adaptador está disponível, o nome do gateway cai num **texto neutro do
  catálogo**; nenhuma tela de membro nomeia o gateway. Alternativa: exigir o nome sempre, o que trava as telas
  quando o adaptador falha.
- **A-12-LOCKED-TOAST**: a **frase nova do toast de aba antiga** para quem tem ingresso (quadro
  `recusa-ingresso-toast`). Alternativa: reaproveitar a frase da recusa genérica.
- **A-10.1-PLUMB**: o plano 08 **alarga só em tempo de compilação** a união de estados da linha de entrega e os
  mapas que a usam, sem mudar comportamento. Alternativa: adiar o alargamento para o plano de tela, o que mistura
  tipos e interface num commit.

## Textos de exemplo no desenho

O texto vem do Copywriting Contract do UI-SPEC onde ele existe. O desenho também mostra, só como **contexto das
telas já entregues** e marcados como exemplo, nomes de demonstração de membros e de eventos, valores em reais, o
produto “Gateway Exemplo” e e-mails no domínio reservado `.invalid`. **Pergunta ao time de design:** algum desses
exemplos mascara um problema de largura ou de quebra de linha que um nome real mais longo, ou um preço de oito
dígitos, causaria em 320px?

## Decisões travadas a montante (não se rediscutem aqui)

D-740 a D-766 do `10.1-CONTEXT.md` e UI-D-740 a UI-D-766 do `10.1-UI-SPEC.md` (as decisões visuais) estão
fixadas. Esta revisão só pergunta se o **desenho** as cumpre, e confirma ou derruba as suposições acima.

## Como revisar e como o resultado é registrado

1. Abra o `index.html`, alterne tema claro e escuro, troque entre as marcas e a largura 320px, e confira os quadros
   de 320px.
2. Comece por `zona-comprar-com-preco` e `participantes-tres-marcas`.
3. **Quem registra o resultado é o Igor**, editando o frontmatter deste arquivo. Para aprovar, troque os valores
   pendentes por estes:

       status: approved
       approved: true
       approved_by: <seu nome>
       approved_at: <AAAA-MM-DD>
       approval_kind: provisional

   Para pedir mudanças, liste-as em `changes_requested:` e deixe `approved: false`; o desenho é então revisado e a
   revisão se repete. Se o Igor dispensar o portão, ele registra a dispensa como decisão no `10.1-CONTEXT.md`, e os
   planos 11 a 14 largam a guarda; o mínimo que ainda vale olhar são os dois quadros acima.

Enquanto este arquivo disser `approved: false`, **todas as tarefas de tela da Fase 10.1 (planos 11 a 14) param na
precondição**. Os planos de banco, contrato, núcleo, API e modelo de leitura (01 a 08) não dependem desta aprovação
e seguem.
