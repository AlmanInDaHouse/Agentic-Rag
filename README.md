# TriForge Agentic Lab

![CI](https://github.com/AlmanInDaHouse/Agentic-Rag/actions/workflows/ci.yml/badge.svg)

Monorepo MVP para experimentar con coordinación de agentes IA, debate estructurado, runtime agentico mockeado y dashboard de monitorización.

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

## Repository Governance

Changes should enter through pull requests targeting `main`; direct commits to `main` are not part of the normal workflow. The required CI check is `Validate`.

Recommended GitHub branch protection for `main`:

- require pull requests before merging,
- require the `Validate` status check,
- require branches to be up to date,
- require conversation resolution,
- restrict force pushes and deletions.

Behavior changes should update the relevant spec in `docs/specs/`. Architecture changes should add or update an ADR. Dependency changes should update security/dependency review docs.

See:

- `docs/repo/BRANCH_PROTECTION.md`
- `docs/repo/PULL_REQUEST_POLICY.md`

## Endpoints MVP

- `GET /health`
- `POST /api/goals`
- `GET /api/goals`
- `POST /api/goals/:goalId/debate-rounds`
- `GET /api/goals/:goalId/debate-rounds/latest`
- `GET /api/goals/:goalId/timeline`
- `POST /api/goals/:goalId/runs`
- `GET /api/goals/:goalId/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/start`
- `POST /api/runs/:runId/advance`
- `POST /api/runs/:runId/cancel`
- `GET /api/runs/:runId/approval-gates`
- `POST /api/approval-gates/:gateId/approve`
- `POST /api/approval-gates/:gateId/reject`
- `POST /api/goals/:goalId/context/sources`
- `GET /api/goals/:goalId/context/sources`
- `GET /api/goals/:goalId/context/quota`
- `GET /api/goals/:goalId/context/audit-events`
- `POST /api/context/sources/:sourceId/documents`
- `GET /api/context/sources/:sourceId/documents`
- `DELETE /api/context/documents/:documentId`
- `POST /api/context/documents/:documentId/restore`
- `GET /api/context/documents/:documentId/chunks`
- `GET /api/embedding-models`
- `POST /api/context/documents/:documentId/embeddings/mock`
- `GET /api/context/documents/:documentId/embeddings`
- `POST /api/context/sources/:sourceId/embeddings/mock`
- `POST /api/goals/:goalId/context/search`
- `GET /api/goals/:goalId/context/retrievals`

Ejemplo:

```bash
curl -X POST http://127.0.0.1:3001/api/goals \
  -H "content-type: application/json" \
  -d '{"title":"Design memory MVP","description":"Define the first persistence strategy for agent memory."}'
```

## Agent Runtime

El runtime actual es una state machine mockeada y trazable. No ejecuta modelos reales, procesos externos, cambios de codigo, instalaciones, migraciones ni operaciones git reales.

Crear un run sobre un goal:

```bash
curl -X POST http://127.0.0.1:3001/api/goals/<goal-id>/runs \
  -H "content-type: application/json" \
  -d '{"objective":"Advance this goal with the mock runtime.","definitionOfDone":["Run reaches completed."],"budget":{"maxSteps":12,"maxFailures":3}}'
```

Crear un run que simula una accion de alto riesgo y requiere approval gate:

```bash
curl -X POST http://127.0.0.1:3001/api/goals/<goal-id>/runs \
  -H "content-type: application/json" \
  -d '{"objective":"Test approval gate.","definitionOfDone":["Gate is approved."],"requestedActions":[{"actionType":"run_command","payload":{"command":"pnpm test"}}],"budget":{"maxSteps":12,"maxFailures":3}}'
```

Arrancar y avanzar un run:

```bash
curl -X POST http://127.0.0.1:3001/api/runs/<run-id>/start \
  -H "content-type: application/json" \
  -d '{}'

curl -X POST http://127.0.0.1:3001/api/runs/<run-id>/advance \
  -H "content-type: application/json" \
  -d '{}'
```

Cancelar un run:

```bash
curl -X POST http://127.0.0.1:3001/api/runs/<run-id>/cancel \
  -H "content-type: application/json" \
  -d '{}'
```

Listar, aprobar o rechazar approval gates:

```bash
curl http://127.0.0.1:3001/api/runs/<run-id>/approval-gates

curl -X POST http://127.0.0.1:3001/api/approval-gates/<gate-id>/approve \
  -H "content-type: application/json" \
  -d '{"resolvedBy":"human","actorRole":"human_operator","reason":"Approved for mock execution"}'

curl -X POST http://127.0.0.1:3001/api/approval-gates/<gate-id>/reject \
  -H "content-type: application/json" \
  -d '{"resolvedBy":"human","actorRole":"human_operator","reason":"Rejected for safety review"}'
```

Estados de run:

```text
created
queued
running
waiting_for_approval
completed
failed
cancelled
stopped
```

Steps mock iniciales:

```text
load_context -> plan -> debate -> judge -> execute_mock_task -> validate -> summarize
```

Approval gates:

- acciones `low` y `medium` se pueden simular automaticamente en el runtime mock,
- acciones `high` crean un approval gate y pasan el run a `waiting_for_approval`,
- acciones `critical` se bloquean por defecto, no crean gate y fallan el run con `ACTION_BLOCKED`.
- `human_operator` y `admin` pueden aprobar/rechazar gates `high`.
- `system` solo se usa para expiraciones/bloqueos automaticos; no puede aprobar `high` o `critical`.
- si `expires_at` vence mientras el gate sigue `pending`, el gate pasa a `expired` y el run a `stopped`.
- `advance` usa transaccion PostgreSQL y lock por run para evitar avances concurrentes duplicados.

Requieren aprobacion humana:

```text
modify_code
run_command
install_dependency
db_migration
external_adapter_call
git_operation
```

Bloqueado por defecto:

```text
delete_file
git_operation force push
git_operation delete branch
git_operation targeting main
db destructive migration
external network call without approved adapter
install_dependency without dependency review
```

Todavia no esta implementado: RAG, GraphRAG, Code Graph, adapters reales de Codex/Claude/Gemini/Ollama, colas de workers, auth para approval gates ni ejecucion autonoma multi-ciclo.

## Context Engine and Mock Embeddings

El Context Engine permite registrar contexto manual, aplicar redaccion regex local, recuperarlo con busqueda lexical y generar embeddings mock deterministas. No usa pgvector, modelos reales, crawlers web, lectores del filesystem ni adapters externos.

Tipos de source permitidos:

```text
manual_text
project_note
artifact
```

Crear un source:

```bash
curl -X POST http://127.0.0.1:3001/api/goals/<goal-id>/context/sources \
  -H "content-type: application/json" \
  -d '{"name":"Runtime notes","type":"manual_text","metadata":{"origin":"local"}}'
```

Anadir un documento de texto:

```bash
curl -X POST http://127.0.0.1:3001/api/context/sources/<source-id>/documents \
  -H "content-type: application/json" \
  -d '{"title":"Approval notes","content":"The load_context step retrieves lexical chunks.","metadata":{}}'
```

Previsualizar redaccion sin persistir:

```bash
curl -X POST http://127.0.0.1:3001/api/context/redact/preview \
  -H "content-type: application/json" \
  -d '{"content":"Contact ops@example.com with token=abcdef1234567890."}'
```

Antes de guardar un documento, la API escanea el texto normalizado. Si detecta datos sensibles, guarda metadata de `classification`, `redactionStatus` y `sensitiveFindings`, y crea chunks con contenido redacted. Los findings no incluyen el valor secreto original. Si detecta contenido `restricted`, como private keys, el documento se bloquea con `409`.

La politica de duplicados sigue usando el hash del contenido original normalizado. Si hubo redaccion, `redactedContentHash` describe el texto usado para chunking/search/embeddings.

La policy de retention/quota inicial limita documentos por goal, tamano de documento, numero/tamano de chunks, retrieval history y embedding rows por documento. Los documentos borrados con soft delete no cuentan como documentos activos para cuota.

Consultar quota y audit events:

```bash
curl http://127.0.0.1:3001/api/goals/<goal-id>/context/quota

curl http://127.0.0.1:3001/api/goals/<goal-id>/context/audit-events
```

Soft delete y restore de documentos:

```bash
curl -X DELETE http://127.0.0.1:3001/api/context/documents/<document-id> \
  -H "content-type: application/json" \
  -d '{"actor":"human_operator","reason":"cleanup","hardDelete":false}'

curl -X POST http://127.0.0.1:3001/api/context/documents/<document-id>/restore \
  -H "content-type: application/json" \
  -d '{"actor":"human_operator","reason":"restore for test"}'
```

Search y embeddings ignoran documentos/chunks deleted. Los retrieval logs existentes se conservan como historico.

Listar chunks de un documento:

```bash
curl http://127.0.0.1:3001/api/context/documents/<document-id>/chunks
```

Buscar contexto:

```bash
curl -X POST http://127.0.0.1:3001/api/goals/<goal-id>/context/search \
  -H "content-type: application/json" \
  -d '{"query":"approval lexical chunks","limit":5,"mode":"lexical"}'
```

Generar embeddings mock para un documento:

```bash
curl -X POST http://127.0.0.1:3001/api/context/documents/<document-id>/embeddings/mock \
  -H "content-type: application/json" \
  -d '{}'
```

Generar embeddings mock para todos los documentos de un source:

```bash
curl -X POST http://127.0.0.1:3001/api/context/sources/<source-id>/embeddings/mock \
  -H "content-type: application/json" \
  -d '{}'
```

Ver cobertura de embeddings para un documento:

```bash
curl http://127.0.0.1:3001/api/context/documents/<document-id>/embeddings
```

Buscar con mock vector o hibrido:

```bash
curl -X POST http://127.0.0.1:3001/api/goals/<goal-id>/context/search \
  -H "content-type: application/json" \
  -d '{"query":"approval lexical chunks","limit":5,"mode":"mock_vector"}'

curl -X POST http://127.0.0.1:3001/api/goals/<goal-id>/context/search \
  -H "content-type: application/json" \
  -d '{"query":"approval lexical chunks","limit":5,"mode":"hybrid"}'
```

Listar retrievals:

```bash
curl http://127.0.0.1:3001/api/goals/<goal-id>/context/retrievals
```

Si `mock_vector` o `hybrid` no encuentran embeddings, la API hace fallback a `lexical` y deja `fallbackUsed`/`fallbackReason` en los resultados persistidos. Cuando un run avanza por `load_context`, el runtime sigue usando `lexical` por defecto, guarda `retrievalId`, `query` y `results` en el output del step y registra `context_retrieval_created` en timeline. Si no hay resultados, el step continua con `results: []`.

Limitaciones actuales:

- `mock_embedding_v1` produce vectores de 32 dimensiones con hashing determinista.
- Es reproducible para CI/harness, pero no representa semantica real.
- Los vectores se guardan en JSONB solo para este milestone; no es un indice vectorial productivo.
- La redaccion actual es regex basica y no es DLP completo.
- Hay policy basica de retention, quota, soft delete/restore y audit; no hay worker de retention ni cuotas tenant-specific.
- No se envia contexto a providers externos.

## RAG roadmap

Estado actual:

- Context Engine usa retrieval lexical por defecto.
- Context ingestion aplica redaccion regex local antes de persistir chunks.
- Hay embeddings mock deterministas para probar boundary, persistencia y harness.
- No hay embeddings reales.
- No hay pgvector.
- No hay GraphRAG ni Code Graph.
- No hay fuentes externas como filesystem, web, GitHub, Gmail o calendar.

Roadmap propuesto:

```text
v1A: spec y ADR de estrategia RAG/embeddings.
v1B: interfaces de embeddings y mock embeddings deterministas.
v1C-A: data policy y redaccion regex local.
v1C-B: retention, quota, soft delete/restore y audit.
v1C: pgvector y embeddings locales opcionales, despues de endurecer data policy.
v1D: retrieval hibrido lexical + vectorial.
```

El fallback lexical debe mantenerse durante todo el rollout. Si embeddings no existen o fallan, `load_context` debe poder seguir usando retrieval lexical y registrar el motivo.

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
