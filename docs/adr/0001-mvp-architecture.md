# ADR 0001: MVP Architecture

## Status

Accepted

## Context

TriForge Agentic Lab necesita un MVP para coordinar agentes IA con debate estructurado, persistencia y dashboard. La restricción principal es mantener una base modular, TypeScript ESM, PostgreSQL sin ORM, contratos Zod y una implementación inicial que funcione con agentes mock antes de añadir adapters reales.

## Folder Architecture

```text
apps/
  api/
    migrations/          SQL versionado propiedad de la API
    src/
      config/            Lectura y validación de entorno
      db/                Pool PostgreSQL y migrator
      domain/            Interfaces puras del dominio
      http/              Rutas Fastify y validación HTTP
      repositories/      SQL parametrizado, sin ORM
      services/          Orquestación de debate, agentes mock y judge mock
      test/              Tests de servicios críticos
  web/
    src/                 Dashboard React + Vite
packages/
  shared/
    src/                 Contratos Zod y tipos inferidos
infra/
  docker/                Compose para PostgreSQL local
docs/
  adr/                   Decisiones técnicas
```

## Technical Decisions

- **React + Vite para frontend:** es la opción más simple para un dashboard MVP; evita el peso de routing/server rendering de Next.js.
- **Fastify para backend:** encaja con TypeScript, tiene bajo overhead y permite rutas explícitas sin framework pesado.
- **PostgreSQL + `pg` sin ORM:** conserva control sobre SQL, migraciones y parametrización; reduce abstracciones prematuras.
- **Zod en `packages/shared`:** una sola fuente para contratos API, tipos frontend y validación backend.
- **Servicios con interfaces:** agentes y judge se modelan como contratos simples para sustituir mocks por adapters reales sin reescribir rutas.
- **Migraciones SQL versionadas:** los cambios de schema viven como archivos auditablemente ordenados en `apps/api/migrations`.
- **Monorepo npm workspaces:** suficiente para el MVP y evita dependencias extra como Nx/Turborepo.
- **Vitest:** runner ligero para TypeScript y React si más adelante se amplía cobertura web.

## Zod Contracts

- `AgentIdSchema`: `codex_architect | claude_critic | gemini_researcher`.
- `CreateGoalRequestSchema`: `{ title: string; description: string }`.
- `GoalSchema`: goal persistido con `id`, `title`, `description`, `status`, `createdAt`, `updatedAt`.
- `AgentProposalSchema`: propuesta persistida con `agentId`, `proposal`, `confidence`.
- `DebateRoundSchema`: ronda con `roundNumber`, estado, decisión y timestamps.
- `DebateRoundWithProposalsSchema`: ronda + propuestas.
- `ApiErrorSchema`: error estable `{ error: string; message: string }`.

## SQL Schema

- `goals`: almacena objetivos creados por el usuario.
- `debate_rounds`: almacena una ronda por goal, número incremental y decisión final.
- `agent_proposals`: almacena las propuestas de cada agente por ronda.
- `triforge_migrations`: tracking de migraciones aplicadas.

Todas las escrituras de aplicación usan SQL parametrizado vía `pg`.

## Endpoints

- `GET /health`: healthcheck.
- `POST /api/goals`: crea un goal.
- `GET /api/goals`: lista goals recientes.
- `POST /api/goals/:goalId/debate-rounds`: crea una ronda, ejecuta tres agentes mock, ejecuta judge mock y persiste resultado.
- `GET /api/goals/:goalId/debate-rounds/latest`: devuelve la última ronda con propuestas para que el dashboard sobreviva a recargas.

## MVP Acceptance Criteria

- El proyecto instala dependencias con `npm install`.
- PostgreSQL local arranca con Docker Compose.
- `npm run db:migrate` aplica migraciones versionadas de forma idempotente.
- `POST /api/goals` crea un goal persistido.
- `GET /api/goals` devuelve goals persistidos.
- `POST /api/goals/:goalId/debate-rounds` crea una ronda con tres propuestas mock y una decisión final.
- El dashboard permite listar goals, crear un goal, lanzar debate y ver propuestas/decisión incluso tras recargar la web.
- Los tests básicos validan la orquestación de debate y el judge mock.
- No hay ORM ni SQL interpolado con valores de usuario.
