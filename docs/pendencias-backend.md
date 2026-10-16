# Pendências de backend

Ajustes de 09/10, de 12/10 e de 15/10 (branch `FRONT-AJUSTES`). Atualizado em 2026-10-16.

## Feed e perfil

### 1. @ do Instagram

- **O que mudou:** campo "Instagram" em Editar perfil. O @ aparece abaixo do nome nas publicações (Início, comunidades, página do post e Reels), no perfil e na lista de membros (quando a bio não tem texto). Hoje ele fica dentro da bio, como última linha depois de uma linha em branco ("Instagram: @perfil", formato em `apps/web/lib/profile-instagram.ts`), e o web lê o `GET /v1/members/{id}` de cada autor para mostrar o @ nos posts. O formulário recusa uma bio cujo próprio texto termina nessa linha, então toda linha nesse formato é de fato o @ da pessoa.
- **Back:**
  - coluna `member_profiles.instagram_handle` com CHECK no formato do front (1 a 30 letras minúsculas, números, ponto e sublinhado, sem ponto no começo, no fim ou dois seguidos);
  - `instagramHandle` no `PATCH /v1/me/profile`, no `ownProfileSchema` e no `memberProfileSchema`;
  - o @ do autor no post (`feedPostAuthorSchema`), vindo na mesma consulta que já traz o nome e a foto;
  - migrar as bios que estão nesse formato: o @ vai para a coluna e a linha sai da bio;
  - decidir se o @ sozinho conta como bio para "Complete seu perfil" (hoje conta, porque está dentro da bio);
  - ordem: os schemas são `.strict()`, então o campo novo entra como `.optional()` e o web é publicado primeiro; depois a migration e a API.
- **Por quê:** a linha gasta até 44 dos 150 caracteres da bio, aparece como texto onde a bio é lida crua e cada página do feed faz uma chamada a mais por autor.

### 2. Proporção dos vídeos

- **O que mudou:** o feed e o Reels descobrem a proporção de cada vídeo no navegador (pela capa e pelos metadados do vídeo) e a guardam durante a visita. Um toque no vídeo do feed agora abre o Reels por cima, já naquele vídeo: a D-124 ("o Reels só abre pela aba") foi revertida a pedido do dono do produto.
- **Back:** expor a largura e a altura do vídeo no post (`postMediaSchema`, onde `width` e `height` vêm nulos para vídeo), ou o `aspect_ratio` que o Mux já envia e que fica guardado em `media_assets.aspect_ratio`, para o quadro já vir certo do servidor. O Reels lê o mesmo `GET /v1/feed?media=video`, então a mudança vale para os dois.
- **Por quê:** até a proporção chegar, o quadro usa um palpite (4:5 no feed, a tela toda no Reels) e pode mudar de tamanho.

## Marca: ícone do app e aparência

### 3. Ícone do app no Android sem moldura

- **O que mudou:** o editor "Ícone do app" (Marca da plataforma, Marca do admin e assistente de novo tenant) monta o ícone no navegador, já com o fundo, e envia um PNG quadrado de 1024 px (JPEG só se o PNG passar de 2 MB) pelo upload de ícone que já existe (`kind: 'icon'`).
- **Back:** no worker (`deriveIconSet`), gerar o `maskable512` ocupando o quadrado inteiro quando a fonte for o ícone do app, em vez de colocá-lo em 80% sobre a cor principal. Precisa de um marcador vindo do upload (um tipo de upload próprio ou o campo do item 4), porque um ícone enviado de outro jeito continua precisando dessa margem.
- **Por quê:** com um fundo diferente da cor principal, aparece uma moldura no Android: a faixa da cor principal em volta do ícone.

### 4. Guardar as escolhas do editor de ícone

- **O que mudou:** as escolhas do editor "Ícone do app" ficam só no navegador; só o ícone pronto é enviado. Nas telas Marca, quem volta à página encontra o editor no padrão, e o ícone não acompanha uma troca da cor principal: o editor avisa para editar o ícone de novo.
- **Back:** um campo `appIcon` na marca com as escolhas (modo, cor ou imagem de fundo, tamanho do logo e as imagens de origem: o logo usado, a imagem de fundo e a arte), devolvido no detalhe do tenant (`GET /v1/platform/tenants/{id}`) e no `GET /v1/admin/branding`. Opcional: refazer o ícone quando a cor principal mudar.
- **Por quê:** o editor reabrir com o que foi usado da última vez, e o ícone acompanhar a cor principal sem ninguém precisar refazê-lo.

### 5. Aparência na Marca do admin

- **O que mudou:** Configurações → Marca mostra a aparência salva do tenant (fundo do modo claro, cores e fundo do modo escuro, cores dos botões) só para leitura, com um aviso de que fundo, modo escuro, botões e fonte dos títulos são definidos pela equipe da plataforma. Só a Marca da plataforma edita a aparência.
- **Back:** rota `PUT /v1/admin/branding/look` com o `brandingLookBodySchema` (o mesmo corpo da rota da plataforma), exigindo `tenant.manage` e usando o tenant da sessão, como as outras rotas de `/v1/admin/branding`. Com a rota, o front só passa o editor de aparência para a página.
- **Por quê:** o admin do tenant mudar a aparência da própria marca, como já muda o logo e as cores.

### 6. Remover o ícone do app de um tenant sem logo

- **O que mudou:** o editor "Ícone do app" deixa criar um tenant só com uma arte, sem logo. Depois de "Remover" o ícone, a prévia passou a mostrar o ícone que o app continua servindo, em vez de dizer que ele usa o ícone padrão da plataforma.
- **Back:** em `removeIconOverride` / `resolveIconSource` (`packages/core/server/platform/branding.ts`), quando o ícone é removido e não há logo, não refazer os ícones a partir da imagem anterior (`previous_i512`): limpar `iconUrls`, para o manifest e o ícone do iPhone voltarem ao padrão da plataforma. A fonte `previous_i512` continua servindo para refazer os ícones depois de uma troca de cor.
- **Por quê:** hoje a derivação que roda depois do "Remover" usa o 512 gerado a partir da arte removida, e o app instalado continua com a arte que o admin tirou.

## Perfil (ajustes de 12/10)

### 7. Lista de membros só para a equipe (feito em 16/10)

- **O que mudou:** a linha "Membros" saiu do Perfil, e a lista `/membros` passou a abrir só para o admin e o suporte do tenant. Um membro que abre o endereço volta para o Perfil, e o "Carregar mais" da lista recusa quem não é da equipe. O perfil de uma pessoa (`/membros/{id}`, aberto pelo nome num post) continua aberto para todos; para o membro, o voltar dessa tela leva ao Início.
- **Back (feito em 16/10):** `GET /v1/members` (com e sem a busca `?q=`, e também com `cursor` ou `limit`) exige papel de equipe (`admin_tenant` ou `support_tenant`) e responde 403 `FORBIDDEN` para `member` antes de ler qualquer membro. O papel é o da participação da sessão no domínio aberto, então quem é admin num tenant e membro em outro lista no primeiro e recebe 403 no segundo. O `GET /v1/members/{id}` continua aberto para membros, porque é ele que abre o perfil pelo nome e mostra o @ do autor nos posts. O `super_admin` não tem participação e continua recebendo 403 `NO_MEMBERSHIP`.
- **Por quê:** o bloqueio não fica mais só nas telas: a própria API agora recusa a lista para quem não é da equipe, do mesmo jeito que a página `/membros` e o "Carregar mais".

### 8. Comunidades do membro

- **O que mudou:** o Perfil ganhou a seção Comunidades, com até 10 comunidades que o membro acessa: as abertas e as exclusivas já liberadas pela Loja (as trancadas ficam de fora). Como não existe participação por comunidade, a seção usa a mesma lista de `/comunidades` (a primeira página, de 25) e a filtra no front com a lista de acesso da Loja (`GET /v1/store/community-access`).
- **Back:** participação por comunidade (entrar e sair, numa tabela de membros da comunidade) e `GET /v1/me/communities` devolvendo as comunidades da pessoa já com o acesso calculado (aberta, liberada ou trancada).
- **Por quê:** hoje a seção mostra as mesmas comunidades para todo mundo, porque todo membro acessa todas as abertas, e o front faz 2 leituras para montá-la.

### 9. "Sua atividade" do membro com dados reais

- **O que mudou:** o Perfil do membro (só o papel `member`; admin e suporte não veem) ganhou "Sua atividade", o relatório do projeto rede-social-dashboard: Tempo de uso (média por dia, gráfico da semana e pico de uso), Seu engajamento (curtidas, comentários, salvamentos, compartilhamentos), O que você viu (posts, stories, vídeos e reels, tempo em vídeos), Onde você mais participa e Presença e constância (presença nos encontros, sequência de semanas). Por decisão do dono do produto, os números são de exemplo e sem etiqueta (`apps/web/lib/member-activity-sample.ts`): todo membro vê os mesmos valores. "Onde você mais participa" também é de exemplo (as comunidades do dashboard), e só aparece com o módulo de comunidades ligado.
- **Back:** `GET /v1/me/activity` com a janela dos últimos 7 dias completos (no fuso do tenant) e a comparação com os 7 dias anteriores:
  - já dá para contar com o que existe no banco: curtidas (`feed_likes`), comentários (`feed_comments`), stories vistos (`story_views` do próprio membro), interações por comunidade (curtidas + comentários por `feed_posts.community_id`), presença nos encontros (check-ins contra confirmações nos últimos 30 dias) e sequência (semanas seguidas com pelo menos uma ação);
  - precisa começar a registrar (tabelas novas, migrations e o app enviando os eventos em lote): sessões de uso (tempo de uso e horário de pico), posts vistos, reprodução de vídeos e reels (quantidade e tempo), compartilhamentos e salvamentos (o app ainda nem tem "salvar post").
- **Por quê:** hoje os números não são do membro. Riscos do lado do back: o registro de visualizações e de tempo gera muita escrita (lote, índices e prazo de retenção); tempo de uso e o que a pessoa viu são dados de comportamento (precisam estar na política de privacidade, com retenção definida, e cada membro só pode ler os próprios); e qualquer migration roda em produção no merge da master, e a homolog usa o mesmo Supabase.

## Painel do dono (ajustes de 15/10)

### 10. Painel do dono para o admin com dados reais

- **O que mudou:** o Perfil do admin do tenant (só o papel `admin_tenant`; membro e suporte não veem) ganhou, logo abaixo de "Complete seu perfil", o painel "Visão do dono": a tela "Dono do cliente" do projeto rede-social-dashboard, com os mesmos cartões e menus. No topo, o ícone e o nome do tenant, "Visão do dono", a janela "30 dias" e o sino de alertas; embaixo, as seis áreas (Visão geral, Membros, Conteúdo, Eventos, Financeiro e Atendimento), com as listas e os detalhes que abrem dentro delas. Tudo navega por parâmetros em `/perfil` (`?area=membros`, `&faixa=`, `&membro=`, `&lista=`, `&vista=`, `&post=`, `&produto=` e os outros, lidos por `apps/web/lib/owner-panel.ts`, `owner-band-scope.ts`, `owner-content-view.ts` e `owner-finance-view.ts`). Por decisão do dono do produto, os números são de exemplo e sem etiqueta (`packages/modules/dashboard/fixtures`): todo tenant vê os mesmos valores, os mesmos 72 membros fictícios, as mesmas publicações, eventos e pedidos. Só são reais o nome e o ícone do tenant e o domínio do cartão "Conta" (o domínio principal do tenant). "Ver operação do dia (painel do admin)" abre Configurações, porque o app não tem o painel do admin do cliente. As ações sugeridas ("Ver todos", "Responder", "Enviar push" e afins) aparecem desativadas.
- **Back:** rotas só para `admin_tenant`, com a janela dos últimos 30 dias (no fuso do tenant) e a comparação com os 30 dias anteriores, uma por área, e as listas paginadas atrás de cada número:
  - já dá para contar com o que existe no banco: crescimento (entraram, saíram, novos por semana, pelas datas de entrada e saída das participações); as seis faixas de engajamento da base, por comunidade e por evento, e os membros de cada faixa (as ações contadas: curtida, comentário, post, RSVP "vou", check-in e pedido pago); interações por publicação, por comunidade e por tipo de publicação (curtidas e comentários por `feed_posts.community_id` e `media_kind`); melhor dia e horário para publicar; visualizações únicas de story (`story_views`, só o total, nunca quem viu); quem curtiu e quem comentou cada publicação, e os comentários sem resposta da equipe; próximos eventos, comparecimento, presencial e online, quem vai (`events.capacity`, RSVPs "vou" e check-ins); receita primária e secundária, receita por produto e por faixa, quem compra e a escada de compra (o primeiro pedido pago de cada membro é a primária, os seguintes a secundária, sempre calculado); vendas até 7 dias depois de uma publicação ou de um evento (associação, não causa); fila, 1ª resposta, atendimentos por semana e equipe (as conversas do suporte e `chat_messages.author_user_id`); moderação (comentários removidos, bloqueios e desbloqueios); os insights de um membro (dias ativos, curtidas, comentários, ações fortes, eventos, compras e quantas conversas de suporte, nunca o texto);
  - precisa começar a registrar (tabelas novas, migrations e o app enviando os eventos em lote): salvamentos e compartilhamentos por publicação; visualizações e alcance por publicação, por membro, guardados só para contar (taxa de engajamento e alcance por faixa dependem disso); reprodução de vídeo (% assistido e retenção); até que cartão cada membro passou no carrossel; cliques no link; toques no story (avançou, voltou, saiu); lista de espera dos eventos lotados; o assunto de cada atendimento; o preço e as vendas de ingresso de cada evento (a receita do cartão de evento); sessões de uso (o tempo médio diário do membro) e posts vistos por membro;
  - o que falta na loja: uma tabela de ofertas e o `offer_id` no pedido (a mesma oferta de entrada e de adicional hoje não se distingue), preencher `expires_at` quando um acesso com prazo é concedido (os "acessos que vencem em 7 dias" dependem disso), rever o `store_orders_live_uq` (impede renovar o mesmo produto sem revogar o pedido anterior) e decidir se um acesso que vence sem renovação encerra a participação;
  - as listas com nomes (membros de cada faixa, quem curtiu ou comentou, quem compra e quanto) só para a equipe do tenant, e todo total de grupo abaixo de 5 pedidos ou pessoas aparece como "menos de 5", sem o número.
- **Por quê:** hoje o painel não é do tenant: todo admin vê a mesma empresa fictícia. Riscos do lado do back: o registro de visualizações, tempo de vídeo e toques gera muita escrita (lote, índices e prazo de retenção); o painel mostra o comportamento individual de cada membro, o que ele curtiu, comentou e comprou, e o texto dos comentários sem resposta (precisa estar na política de privacidade, com retenção definida, e nunca sair da equipe do tenant); e qualquer migration roda em produção no merge da master, e a homolog usa o mesmo Supabase.
