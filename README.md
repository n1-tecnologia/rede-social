# Rede Social

Plataforma de comunidades **white-label** e **multi-tenant**. Cada organização (criador, empresa, instituição) ganha a própria comunidade com marca própria (logo, cores, favicon e nome) num domínio próprio, por exemplo `comunidade.cliente.com.br`. Todas rodam num único deploy, e os dados de cada tenant ficam isolados dos outros.

O app é mobile-first, instalável como PWA e responsivo no desktop. A interface é em pt-BR.

## Funcionalidades (V1)

Já implementado:

- **Feed**: posts com imagem, vídeo, links e anexos; curtidas, comentários e compartilhamento.
- **Stories**, destaques e **Reels**.
- **Comunidades** dentro do tenant.
- **Eventos**: confirmação de presença (RSVP) e check-in por código.
- **Perfis de membro**, cadastro por convite e recuperação de senha.
- **Painel da plataforma** (`super_admin`): cria tenants e gerencia domínios e marca.

Em desenvolvimento: notificações, Web Push e chat com o suporte do tenant; moderação e painel do admin do tenant.

Na V1 só o admin do tenant publica; os membros consomem e interagem. O modelo de dados já está pronto para a V2, em que qualquer membro publica e conversa com outros membros.

## Stack

| Camada | Tecnologia |
|---|---|
| Web | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS v4, shadcn/ui, Serwist (PWA) |
| API | Hono em Node.js 24 (Cloud Run); o worker (pg-boss) usa a mesma imagem |
| Banco / plataforma | Supabase: Postgres com RLS, Auth, Storage, Realtime Broadcast |
| ORM | Drizzle ORM + drizzle-kit (as migrations são aplicadas pelo Supabase CLI) |
| Contratos | Zod 4, compartilhado entre API e web; cliente RPC do Hono |
| Vídeo | Mux |
| Monorepo | pnpm workspaces + Turborepo |
| Qualidade | TypeScript 7, Biome, Vitest, Playwright, pgTAP |

## Estrutura

```
apps/
  web/                 Next.js (PWA, BFF de autenticação por cookies HttpOnly)
  api/                 API Hono + worker (ROLE=api | ROLE=worker)
packages/
  core/                kernel: banco, tenancy, auth, jobs, branding, UI base
  contracts/           schemas Zod e tipos compartilhados
  ui/                  componentes compartilhados
  config/              tsconfig, vitest e biome compartilhados
  modules/
    feed/  stories/  reels/  communities/  events/
supabase/              config.toml, migrations, roles, templates, testes pgTAP
scripts/               seed, ambiente local e verificações
docs/                  contrato de deploy (DEPLOY.md) e e-mails de autenticação
```

Cada módulo em `packages/modules/*` reúne schema, API e UI da sua funcionalidade. Ele depende só do kernel e dos contratos publicados pelos outros módulos, e cada tenant pode ligar ou desligar o módulo.

## Rodando localmente

Pré-requisitos: Node.js 24, pnpm 12, Docker (para o Supabase local) e o Supabase CLI.

```bash
pnpm install
pnpm supabase start                  # sobe Postgres, Auth, Storage e Realtime no Docker
pnpm db:reset                        # aplica as migrations e cria o papel api_user
bash scripts/local-env.sh --write    # gera apps/api/.env.local e apps/web/.env.local
pnpm db:seed                         # tenants de exemplo, admins e membros

pnpm --filter @rede-social/api dev   # API em http://localhost:8787
pnpm --filter @rede-social/web dev   # web em http://localhost:3000
```

O host escolhe o tenant, então o acesso local é por subdomínios de `localhost`:

| Endereço | O que abre |
|---|---|
| http://rede-demo.localhost:3000 | tenant de exemplo "Rede Demo" |
| http://rede-lab.localhost:3000 | tenant de exemplo "Rede Lab" |
| http://rede-social.localhost:3000 | painel da plataforma (`super_admin`) |

O seed cria as contas `admin@<slug>.local` e `member@<slug>.local` para cada tenant. A senha é a do `SEED_PASSWORD`, que o `local-env.sh` gera. As variáveis estão documentadas em [`.env.example`](.env.example).

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm lint` | Biome e checagem de literais nos componentes (cores, classes, textos fora do catálogo) |
| `pnpm typecheck` | TypeScript em todos os pacotes |
| `pnpm test` | testes unitários (Vitest) |
| `pnpm test:integration` | testes de integração da API (precisa do Supabase local) |
| `pnpm supabase test db` | testes pgTAP de RLS e isolamento entre tenants |
| `pnpm e2e` | testes e2e (Playwright) |
| `pnpm boundaries` | garante que os módulos respeitam as fronteiras entre pacotes |
| `pnpm db:generate` | gera uma migration a partir do schema Drizzle |
| `pnpm verify` | a bateria completa usada como critério de saída de cada fase |

## Isolamento entre tenants

O isolamento tem três camadas:

1. O host só escolhe a casca pública do app. Depois do login, o tenant é o da associação (membership) do usuário, e a API rejeita uma sessão que não pertença ao tenant do host (`TENANT_HOST_MISMATCH`).
2. Toda consulta da API é filtrada pelo tenant da requisição.
3. RLS no Postgres: a API se conecta como `api_user` (`NOBYPASSRLS`). Cada política tem um teste pgTAP negativo entre tenants.

## Deploy

- **Web**: Vercel, pela integração com o Git.
- **API e worker**: Cloud Run, via GitHub Actions.
- **Banco**: Supabase; as migrations são aplicadas com `supabase db push`.

Nomes de variáveis, segredos e ambientes estão em [`docs/DEPLOY.md`](docs/DEPLOY.md).
