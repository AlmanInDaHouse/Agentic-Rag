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

PostgreSQL con pgvector es opcional para experimentos locales y no se usa por defecto:

```bash
docker compose -f infra/docker/docker-compose.yml --profile vector up -d postgres-vector
```

El servicio opcional queda en el puerto local `5433`. El harness estandar sigue usando `postgres:16` sin pgvector.

Para usar el servicio vectorial local:

```bash
DATABASE_URL=postgres://triforge:triforge@localhost:5433/triforge
pnpm db:migrate
psql "$DATABASE_URL" -f infra/sql/enable_pgvector.sql
TRIFORGE_EMBEDDING_STORAGE=pgvector pnpm dev:api
```

La migracion estandar no fuerza `CREATE EXTENSION vector`; si la extension no esta instalada, la tabla vectorial opcional se omite de forma segura.

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
pnpm test:retrieval-eval
pnpm test:harness
pnpm eval:retrieval
pnpm eval:retrieval:gate
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
- `GET /api/rag/status`
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

Todavia no esta implementado: RAG semantico real, GraphRAG, Code Graph, adapters reales de Codex/Claude/Gemini/Ollama, colas de workers, auth para approval gates ni ejecucion autonoma multi-ciclo.

## Context Engine and Mock Embeddings

El Context Engine permite registrar contexto manual, aplicar redaccion regex local, recuperarlo con busqueda lexical y generar embeddings mock deterministas. pgvector puede usarse como retrieval vectorial activo solo si se configura explicitamente y la base de datos tiene extension/tabla vectorial. No usa modelos reales obligatorios, crawlers web, lectores del filesystem ni adapters externos.

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

Ver estado RAG, provider activo, storage activo y fallbacks:

```bash
curl http://127.0.0.1:3001/api/rag/status
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

Si `mock_vector` o `hybrid` no encuentran embeddings, la API hace fallback a `lexical` y deja `fallbackUsed`/`fallbackReason` en los resultados persistidos. Si `TRIFORGE_EMBEDDING_STORAGE=pgvector` esta configurado pero pgvector no esta disponible, la API cae a JSONB/mock-vector si hay embeddings, y luego a lexical. Los resultados persistidos incluyen `searchMode`, `vectorStorageUsed`, `fallbackUsed`, `fallbackReason`, `lexicalScore`, `vectorScore` y `finalScore`. Search tambien devuelve `answerability`, una decision deterministica de abstencion basada en metadata de retrieval. Cuando un run avanza por `load_context`, el runtime sigue usando `lexical` por defecto, guarda `retrievalId`, `query`, `results` y `answerability` en el output del step y registra `context_retrieval_created` en timeline. Si no hay resultados, el step continua con `results: []` y `shouldAnswer=false`.

Limitaciones actuales:

- `mock_embedding_v1` produce vectores de 32 dimensiones con hashing determinista.
- Es reproducible para CI/harness, pero no representa semantica real.
- Los vectores mock se guardan en JSONB por defecto; no es un indice vectorial productivo.
- pgvector es opcional, se activa solo con `TRIFORGE_EMBEDDING_STORAGE=pgvector` y no se requiere para CI/harness.
- `/api/rag/status` reporta extension pgvector, tabla pgvector, storage configurado, storage efectivo, fallback reason y si vector search esta habilitado.
- El endpoint local de embeddings es opt-in y debe apuntar a localhost/loopback.
- La redaccion actual es regex basica y no es DLP completo.
- Hay policy basica de retention, quota, soft delete/restore y audit; no hay worker de retention ni cuotas tenant-specific.
- No se envia contexto a providers externos.

## RAG roadmap

Estado actual:

- Context Engine usa retrieval lexical por defecto.
- Context ingestion aplica redaccion regex local antes de persistir chunks.
- Hay embeddings mock deterministas para probar boundary, persistencia y harness.
- pgvector existe solo como capacidad opcional/local, no como requisito ni indice activo por defecto.
- pgvector tiene retrieval activo opcional cuando extension/tabla existen y `TRIFORGE_EMBEDDING_STORAGE=pgvector`.
- Local embeddings son opt-in; no hay modelo real obligatorio.
- Hay un harness de evaluacion de retrieval con fixtures sinteticos y metricas simples.
- No hay GraphRAG ni Code Graph.
- No hay fuentes externas como filesystem, web, GitHub, Gmail o calendar.

Roadmap propuesto:

```text
v1A: spec y ADR de estrategia RAG/embeddings.
v1B: interfaces de embeddings y mock embeddings deterministas.
v1C-A: data policy y redaccion regex local.
v1C-B: retention, quota, soft delete/restore y audit.
v1C: pgvector y embeddings locales opcionales con fallback mock/jsonb/lexical.
v1D: retrieval hibrido lexical + vectorial con pgvector activo opcional.
v1E: evaluation harness con fixtures sinteticos, metricas y reportes.
v1F: baselines y quality gates de retrieval con thresholds versionados.
v1G: corpus ampliado de retrieval eval con query types y fixtures sinteticas adversariales.
v1H: politica deterministica de abstencion RAG basada en metadata de retrieval.
```

El fallback lexical debe mantenerse durante todo el rollout. Si embeddings no existen o fallan, `load_context` debe poder seguir usando retrieval lexical y registrar el motivo.

## Retrieval Evaluation

El harness de evaluacion vive en `tooling/retrieval-eval`. Usa fixtures sinteticos, ingesta documentos por la API HTTP del harness, ejecuta queries en `lexical`, `mock_vector` y `hybrid`, calcula metricas y escribe reportes.

Tests unitarios de metricas:

```bash
pnpm test:retrieval-eval
```

Evaluacion completa local:

```bash
pnpm eval:retrieval
```

Quality gate local:

```bash
pnpm eval:retrieval:gate
```

La evaluacion completa requiere PostgreSQL local igual que `pnpm test:harness`. Los reportes runtime se generan en:

```text
reports/retrieval-eval/latest.json
reports/retrieval-eval/latest.md
```

Estos reportes no se commitean por defecto. Las metricas sobre mock embeddings validan pipeline y ranking reproducible, no calidad semantica real. LLM-as-judge, providers externos, modelos reales obligatorios, GraphRAG y Code Graph quedan fuera de scope.

El corpus incluye queries `answerable`, `ambiguous`, `redaction` y `no_answer`, con tags como `security`, `runtime`, `retention`, `redaction`, `ambiguous` y `no_answer`. Los datos siguen siendo sinteticos. Las queries `no_answer` usan expected vacio de forma explicita; no significan que search deba devolver cero filas, sino que no hay chunk esperado que el evaluador deba inventar. Los reportes separan queries totales de queries con metrica de retrieval para que `no_answer` no infle los promedios agregados.

La evaluacion de retrieval tambien captura `answerability` y calcula `abstention_accuracy`, `false_answer_rate` y `false_abstention_rate`. Estas metricas conectan `no_answer` con comportamiento real de abstencion, pero siguen siendo informativas inicialmente porque los thresholds son heuristicos y el corpus es sintetico.

Los thresholds y baselines versionados viven en:

```text
tooling/retrieval-eval/baselines/thresholds.v1.json
tooling/retrieval-eval/baselines/baseline.v1.json
```

Para actualizar thresholds o baseline, ejecutar la evaluacion, inspeccionar `reports/retrieval-eval/latest.json` y `latest.md`, y commitear solo el cambio intencional en los JSON versionados. `precisionAtK`, `recallAtK`, `fallbackUsedRate`, `abstentionAccuracy`, `falseAnswerRate` y `falseAbstentionRate` son informativos inicialmente; `hitAtK`, `expectedChunkFound` y `meanReciprocalRank` son los gates bloqueantes. pgvector sigue siendo opt-in fuera del gate obligatorio.

Cuando el gate falla, la seccion `Quality Gate` lista fixture, modo, query, metrica, valor esperado y valor real para cada regresion bloqueante.

## Variables de entorno

La API usa estas variables con defaults locales:

```text
PORT=3001
HOST=0.0.0.0
DATABASE_URL=postgres://triforge:triforge@localhost:5432/triforge
TRIFORGE_DB_SCHEMA=public
TRIFORGE_EMBEDDING_PROVIDER=mock
TRIFORGE_EMBEDDING_STORAGE=jsonb
TRIFORGE_LOCAL_EMBEDDING_ENDPOINT=
TRIFORGE_LOCAL_EMBEDDING_DIMENSION=32
```

Para probar un endpoint local, mantenerlo en localhost/loopback y no usar proveedores externos:

```bash
TRIFORGE_EMBEDDING_PROVIDER=local
TRIFORGE_LOCAL_EMBEDDING_ENDPOINT=http://127.0.0.1:11434/api/embed
TRIFORGE_LOCAL_EMBEDDING_DIMENSION=32
```

Para solicitar storage pgvector opcional:

```bash
TRIFORGE_EMBEDDING_STORAGE=pgvector
```

Si pgvector o el endpoint local no estan disponibles, la API sigue arrancando y `/api/rag/status` reporta fallback a `jsonb`, `mock` y lexical. Para que pgvector sea efectivo, `postgres-vector` debe estar activo y `infra/sql/enable_pgvector.sql` debe haberse aplicado en la base de datos/schema usados por la API.

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
