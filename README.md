# TriForge Agentic Lab

![CI](https://github.com/AlmanInDaHouse/Agentic-Rag/actions/workflows/ci.yml/badge.svg)

Monorepo MVP para experimentar con coordinación de agentes IA, debate estructurado y dashboard de monitorización.

## Stack

- TypeScript ESM.
- API Fastify.
- Web React + Vite.
- PostgreSQL con SQL parametrizado y sin ORM.
- Migraciones SQL versionadas.
- Zod para contratos compartidos.
- pnpm workspaces.
- Vitest para tests básicos.

## Estructura

```text
apps/
  api/        Fastify, servicios, repositorios SQL y migraciones
  web/        Dashboard React + Vite
packages/
  shared/     Contratos Zod y tipos compartidos
infra/
  docker/     Docker Compose para PostgreSQL local
docs/
  adr/        Decisiones de arquitectura
```

## Arranque local

0. Activar pnpm con Corepack:

```bash
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

Si `corepack enable` no tiene permisos para escribir en la instalación global de Node en Windows, puedes instalar los shims en un directorio de usuario y añadirlo a `PATH`.

1. Instalar dependencias:

```bash
pnpm install
```

2. Levantar PostgreSQL:

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres
```

3. Ejecutar migraciones:

```bash
pnpm db:migrate
```

4. Arrancar API:

```bash
pnpm dev:api
```

La API queda en `http://127.0.0.1:3001`.

5. Arrancar dashboard:

```bash
pnpm dev:web
```

La web queda en `http://127.0.0.1:5173`.

## Scripts

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm test:harness
pnpm harness:mvp
pnpm db:migrate
pnpm audit
pnpm lint:deps
pnpm deps:outdated
```

## CI

GitHub Actions runs on pushes and pull requests targeting `main`. The workflow uses Node.js 22, pnpm via Corepack, PostgreSQL 16 as a service container, and executes dependency checks, typecheck, unit tests, harness tests, build and audit.

## Endpoints MVP

- `GET /health`
- `POST /api/goals`
- `GET /api/goals`
- `POST /api/goals/:goalId/debate-rounds`
- `GET /api/goals/:goalId/debate-rounds/latest`
- `GET /api/goals/:goalId/timeline`

Ejemplo:

```bash
curl -X POST http://127.0.0.1:3001/api/goals \
  -H "content-type: application/json" \
  -d '{"title":"Design memory MVP","description":"Define the first persistence strategy for agent memory."}'
```

## Variables de entorno

La API usa estas variables con defaults locales:

```text
PORT=3001
HOST=0.0.0.0
DATABASE_URL=postgres://triforge:triforge@localhost:5432/triforge
TRIFORGE_DB_SCHEMA=public
```

La web puede configurar:

```text
VITE_API_URL=http://127.0.0.1:3001
```

## Notas

El MVP usa agentes mock:

- `codex_architect`
- `claude_critic`
- `gemini_researcher`

El judge mock elige la propuesta con mayor `confidence` y deja una justificación persistida.

El harness usa schemas PostgreSQL temporales `harness_*` por ejecución y los limpia al terminar.

## Working with Codex

Antes de cada sesión de Codex, leer:

1. `docs/context/PROJECT_CONTEXT.md`
2. `docs/specs/PROJECT_SPEC.md`
3. La spec concreta de la feature
4. ADRs relevantes
5. Tests/harness relevantes

No se deben implementar nuevas features sin una spec previa y criterios de aceptación actualizados.
