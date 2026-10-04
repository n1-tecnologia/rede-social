# Pendências de backend

## Situação (2026-10-03)

Todos os itens abaixo foram implementados e testados **só no ambiente local**, sem commit e sem deploy.

**Diferenças em relação ao plano:**

- **Marca:** os seis ajustes ficam num objeto só, `branding.look`, salvo por uma rota nova, `PUT /v1/platform/tenants/{id}/branding/look`. A rota de cores fica como está, com a trava de contraste. A primária escura escolhida fica em `look.darkColors.primary`, para não se confundir com a derivada.
- **Vagas:** a trava fica no gatilho `app.event_attendance_guard()`, que vale para qualquer escrita. A API responde `409 CONFLICT` com `details.event = 'event_full'`.
- **Fotos:**
  - Usam mídia do tipo `post`, então a trava de tipos de `media_assets` não muda.
  - Rotas: `GET`/`POST /v1/events/{id}/photos` e `DELETE /v1/events/{id}/photos/{photoId}`.
- **Ordem das comunidades:**
  - Uma ordem desatualizada responde `409 CONFLICT` com `details.community = 'order_stale'`.
  - As faixas de comunidades do Reels seguem a mesma ordem.
- **Stories:** o campo devolvido é `authorAvatarUrl`.

**Migrations, em ordem:**

1. `20261003233449_event_category_capacity`
2. `20261003233515_event_photos`
3. `20261003233540_community_position`
4. `20261003233626_event_capacity_guard`

Todas são aditivas.

**Ordem de deploy:**

1. Publicar o **web primeiro**, porque ele lê as respostas da API com validação estrita. Um web antigo recusa os campos novos, e Eventos, Comunidades, Stories e as telas deslogadas quebram.
2. Depois publicar a **API**: o merge na `master` aplica as migrations no banco de produção e sobe API e worker.

A marca do tenant fica na coluna `branding` (jsonb) da tabela `tenants`. Por isso, os itens de marca não pedem coluna nova, só campos novos dentro dela. Para cada campo novo é preciso:

- **Na rota:** `PUT /v1/platform/tenants/{id}/branding/colors` passa a aceitá-lo e validá-lo. Hoje o `brandingColorsBodySchema` é strict e só aceita `primary` e `secondary`.
- **No contrato:** entra no `tenantBrandingSchema`.
- **No bootstrap:** é devolvido junto com a marca.

## Marca do tenant

**Cor dos botões:**
Para adicionar a funcionalidade que dá aos botões de ação (Entrar, Completar agora, os de criar) uma cor própria, separada da primária, precisa adicionar um campo no `branding`. O campo chamará `buttonColors.fill` (cor do botão) e `buttonColors.ink` (cor do texto), cada um com um valor para o modo claro e outro para o escuro.

**Degradê no botão:**
Para adicionar a funcionalidade que pinta os botões com um degradê de duas cores, precisa adicionar um campo no `branding`. O campo chamará `buttonColors.style` (`solid` ou `gradient`) e `buttonColors.fillEnd` (a cor final do degradê, clara e escura).

**Cor de fundo (tom):**
Para adicionar a funcionalidade que troca o fundo do app (amarelado, lilás etc.), precisa adicionar um campo no `branding`. O campo chamará `lightTone` e `darkTone` e só aceitará os nomes de tom da lista fixa: `cinza`, `amarelado`, `laranjado`, `avermelhado`, `lilas`, `azulado`, `agua`, `esverdeado` no claro, e os pares `grafite`, `cafe`, `terracota`, `vinho`, `berinjela`, `azul-noite`, `petroleo`, `musgo` no escuro.

**Cores do modo escuro:**
Para adicionar a funcionalidade que deixa o dono escolher a primária e a secundária do modo escuro, a rota precisa aceitar o `colors.primaryDark` escolhido e recalcular o `onPrimaryDark`. Hoje o `primaryDark` é sempre derivado da primária. Também precisa de um campo novo, `colors.secondaryDark`.

**Fonte dos títulos:**
Para adicionar a funcionalidade que troca a fonte dos títulos por uma do Google Fonts, precisa adicionar um campo no `branding`. O campo chamará `titleFont`, com o nome exato da família ou nulo para a fonte padrão, e a rota recusará um nome que não seja uma família válida.

**Cor dos títulos e do nome do app:**
Para adicionar a funcionalidade que pinta os títulos e o nome do app no topo com cores próprias, precisa adicionar um campo no `branding`. O campo chamará `fontColors.title` e `fontColors.appName`, cada um com valor claro e escuro.

## Eventos (tabela `events`)

**Categoria do evento:**
Para adicionar a funcionalidade que mostra o tipo do evento no cartão ("Imersão presencial", "Workshop"), precisa adicionar uma coluna no banco. A coluna chamará `category` (texto, opcional). Ela fará:

- as rotas de criar e editar evento aceitarem o valor;
- `GET /v1/events` e `GET /v1/events/{id}` devolverem o valor no `eventSummarySchema`.

**Cidade no cartão:**
Para adicionar a funcionalidade que mostra a cidade ("São Paulo, SP") no cartão da lista, não precisa de coluna nova, porque o endereço já fica na coluna `address`. A rota `GET /v1/events` só precisa devolver `address` também na lista; hoje só o detalhe devolve.

**Vagas ("Últimas N vagas"):**
Para adicionar a funcionalidade que avisa quando restam poucas vagas, precisa adicionar uma coluna no banco. A coluna chamará `capacity` (inteiro, opcional; vazio quer dizer sem limite). Ela fará:

- as rotas de criar e editar evento aceitarem o limite;
- a lista e o detalhe devolverem `capacity`;
- a rota `PUT /v1/events/{id}/rsvp` recusar um "Vou" novo quando o evento lotar.

**Fotos do evento (aba Fotos):**
Para adicionar a funcionalidade que mostra as fotos de cada evento, precisa adicionar uma tabela nova. A tabela chamará `event_photos`, com as colunas `id`, `tenant_id`, `event_id`, `media_asset_id`, `created_by_user_id` e `created_at`, e RLS por tenant. Ela fará funcionar uma rota para o admin enviar fotos, pelo mesmo pipeline de mídia, e outra para listar as fotos de um evento.

## Comunidades (tabela `communities`)

**Ordem das comunidades:**
Para adicionar a funcionalidade que deixa o admin escolher a ordem das comunidades, precisa adicionar uma coluna no banco. A coluna chamará `position` (inteiro). Ela fará:

- a lista ordenar por `position` (hoje ordena por `updated_at` e `last_activity_at`);
- funcionar uma rota nova, por exemplo `PUT /v1/communities/order`, que recebe os ids na ordem nova e só aceita quem tem `communities.community.manage`.

## Stories

**Foto do autor no círculo do tenant:**
Para adicionar a funcionalidade que mostra a foto de quem publicou no círculo de stories do tenant, não precisa de coluna nova, porque a foto já fica em `member_profiles.avatar_asset_id`. A rota de stories só precisa devolver, ao lado do `authorUserId`, a foto do autor, por exemplo `authorAvatarUrl`, no formato `/v1/media/{id}/w128` que o perfil já usa.
