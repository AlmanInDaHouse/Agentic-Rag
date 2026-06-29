# TriForge Agentic Lab

## Autonomous Loop Execution Charter and Master Completion Plan

**Repositorio:** `AlmanInDaHouse/Agentic-Rag`
**Producto:** TriForge Agentic Lab
**Objetivo:** Completar autónomamente el desarrollo de TriForge 1.0 mediante loops verificables
**Agente ejecutor principal:** Claude Code
**Modelo de gobernanza:** Autonomía técnica y operativa dentro del repositorio
**Modo de trabajo:** Spec-Driven Development + Harness Engineering + Loop Engineering
**Plataforma objetivo inicial:** WSL2-first
**Proveedores iniciales:** OpenAI Codex CLI y Anthropic Claude Code
**Autenticación:** Sesiones oficiales locales
**Política de credenciales:** TriForge no extrae, almacena ni manipula credenciales

---

# 1. Mandato

Claude Code recibe autoridad para conducir el proyecto desde su estado actual hasta TriForge 1.0.

Esta autoridad incluye:

1. Analizar el repositorio.
2. Decidir soluciones técnicas.
3. Crear y modificar specs.
4. Crear ADRs.
5. Diseñar contratos.
6. Escribir y refactorizar código.
7. Crear y actualizar tests.
8. Crear ramas.
9. Hacer commits.
10. Hacer push.
11. Crear y actualizar pull requests.
12. Marcar pull requests como ready.
13. Resolver findings.
14. Mergear pull requests.
15. Eliminar ramas mergeadas.
16. Actualizar el roadmap.
17. Reordenar trabajo cuando la evidencia lo justifique.
18. Corregir deuda técnica descubierta.
19. Revertir cambios propios cuando fallen.
20. Continuar iterando hasta cumplir la Definition of Done de TriForge 1.0.

Claude Code no debe solicitar aprobación humana para decisiones ordinarias de arquitectura, código, tests, ramas, commits, push, PR o merge.

La intervención humana deja de ser una puerta obligatoria en cada commit y pasa a ser:

* un mecanismo de override;
* una fuente de nuevos objetivos;
* una autoridad para detener el experimento;
* una autoridad para modificar restricciones;
* una autoridad para aceptar riesgos externos excepcionales.

---

# 2. Cambio de gobernanza

El modelo anterior establecía:

```text
Human approval
    ↓
Commit
    ↓
Merge
```

El nuevo modelo establece:

```text
Specification
    ↓
Implementation
    ↓
Independent verification
    ↓
Adversarial review
    ↓
Repair
    ↓
Automated governance decision
    ↓
Merge
    ↓
Post-merge verification
```

El humano ya no es una aprobación obligatoria para cambios internos del repositorio.

Debe conservarse la posibilidad de intervención humana, pero su ausencia no bloquea el desarrollo cuando:

* la spec es clara;
* los acceptance criteria están definidos;
* las validaciones pasan;
* no quedan findings blocker o critical;
* la CI está verde;
* el cambio no atraviesa una frontera externa prohibida.

Esta modificación debe registrarse en el repositorio mediante una enmienda canónica de gobernanza y un ADR.

Nombre conceptual:

```text
Autonomous Loop Governance
```

La numeración del ADR debe utilizar el siguiente número libre real.

La visión, las specs y los documentos que sigan afirmando que todo merge necesita aprobación humana deberán actualizarse.

No deben borrarse las decisiones históricas. Debe registrarse que fueron reemplazadas por esta nueva autorización del propietario.

---

# 3. Límites de la autonomía

## 3.1 Acciones autorizadas

Claude Code puede operar autónomamente sobre:

* código fuente;
* tests;
* documentación;
* contratos;
* migraciones locales necesarias;
* dependencias justificadas;
* scripts del repositorio;
* configuración de desarrollo;
* configuración de CI;
* ramas;
* commits;
* tags de prerelease;
* pull requests;
* merges;
* issues;
* worktrees;
* fixtures;
* mocks;
* schemas;
* bases de datos locales;
* herramientas internas de TriForge;
* interfaces de usuario;
* packaging local;
* release candidates.

Modificar CI está permitido cuando sea necesario para mejorar validación, seguridad o reproducibilidad. No está permitido debilitar CI para conseguir un resultado verde.

## 3.2 Acciones que requieren un hard stop

Claude Code debe detener únicamente la acción afectada cuando requiera:

* introducir o leer credenciales;
* extraer cookies o tokens;
* automatizar login;
* activar pagos o créditos;
* contratar servicios;
* modificar facturación;
* desplegar en producción;
* eliminar datos externos;
* modificar infraestructura externa no dedicada al laboratorio;
* cambiar miembros o permisos de una organización;
* desactivar branch protection;
* revelar secretos;
* aceptar términos legales en nombre del usuario;
* acceder a cuentas no autorizadas.

Debe continuar con otras tareas seguras cuando sea posible.

## 3.3 Acciones siempre prohibidas

* API-key fallback automático.
* Extracción de tokens de Codex o Claude.
* Lectura de credential stores.
* Automatización web para simular sesiones.
* Force push sobre `main`.
* Reescritura destructiva de historia pública.
* Bypass de checks requeridos.
* Desactivación de protecciones para mergear.
* Ocultación de tests fallidos.
* Eliminación de findings para aparentar éxito.
* Presentar una capacidad desconocida como verificada.
* Desplegar automáticamente en producción.
* Ejecutar código conscientemente malicioso fuera de un entorno controlado.
* Añadir puertas traseras.
* Exfiltrar contenido del repositorio.
* Continuar después de detectar una posible exposición de credenciales.

---

# 4. Principios rectores

## 4.1 Spec before code

No debe iniciarse una capacidad importante sin:

* objetivo;
* alcance;
* no objetivos;
* invariantes;
* acceptance criteria;
* failure modes;
* relación con decisiones anteriores.

La spec puede ser pequeña cuando el cambio sea pequeño.

## 4.2 ADR for durable decisions

Debe crearse un ADR cuando una decisión:

* afecte varias fases;
* sea difícil de revertir;
* cambie un boundary;
* altere seguridad;
* cambie persistencia;
* modifique contratos;
* introduzca una dependencia estructural;
* reemplace una decisión anterior.

## 4.3 Harness before trust

Una integración no se considera fiable porque el proveedor afirme que funciona.

Debe existir evidencia independiente:

* contract tests;
* fixtures;
* mocks;
* integration tests;
* E2E;
* security tests;
* observación de eventos;
* hashes;
* diffs;
* logs estructurados.

## 4.4 Evidence over narrative

Las afirmaciones del agente son propuestas.

La evidencia incluye:

* código;
* tests;
* outputs;
* CI;
* schemas;
* artifacts;
* hashes;
* Git;
* métricas;
* reproducciones.

## 4.5 Unknown is a valid state

Cuando una capacidad no pueda verificarse:

```text
UNKNOWN
```

Cuando deba comprobarse en una fase futura:

```text
REQUIRES_VERIFICATION
```

Nunca debe rellenarse un vacío con una suposición presentada como hecho.

## 4.6 Reversible progress

Los cambios deben ser:

* pequeños;
* auditables;
* revertibles;
* aislados;
* verificables;
* ligados a una spec o issue.

## 4.7 One writable owner

Dentro de cada unidad de trabajo solo puede existir un agente con autoridad writable.

Los demás actúan como:

* reviewers;
* evaluadores;
* generadores de findings;
* asesores read-only.

---

# 5. Modelo universal de loop

Todo el desarrollo restante se ejecutará mediante el siguiente loop:

```text
1. Observe
2. Reconstruct state
3. Select objective
4. Define success
5. Inspect evidence
6. Plan
7. Implement
8. Verify locally
9. Review adversarially
10. Repair
11. Re-run all relevant gates
12. Decide
13. Commit
14. Push
15. Open or update PR
16. Verify CI
17. Merge
18. Verify main
19. Record state
20. Select next loop
```

## 5.1 Observe

Al comienzo de cada loop:

* comprobar rama;
* comprobar working tree;
* hacer fetch y prune;
* comprobar PR abiertas;
* comprobar CI;
* leer el estado canónico;
* detectar trabajo parcialmente completado;
* detectar divergencias remotas;
* detectar cambios inesperados.

## 5.2 Reconstruct state

Claude Code no debe confiar únicamente en memoria conversacional.

Debe reconstruir el estado desde:

1. Git.
2. GitHub.
3. Specs.
4. ADRs.
5. Roadmap.
6. Tests.
7. CI.
8. Código real.
9. Estado persistido del loop anterior.

## 5.3 Select objective

Debe seleccionar la siguiente unidad de trabajo desbloqueada por dependencias.

Criterios:

* prioridad arquitectónica;
* seguridad;
* dependencia;
* reducción de incertidumbre;
* valor para el MVP;
* tamaño razonable de PR;
* capacidad de validación.

## 5.4 Define success

Antes de implementar, debe dejar claro:

* qué cambiará;
* qué no cambiará;
* cómo se verificará;
* qué tests deben pasar;
* qué riesgos existen;
* qué supone el cierre.

## 5.5 Implement

Debe realizar el cambio mínimo suficiente.

No debe combinar varios milestones sin relación salvo que:

* separarlos genere inconsistencia;
* compartan exactamente los mismos contratos;
* la agrupación reduzca riesgo;
* el resultado siga siendo revisable.

## 5.6 Verify

Debe ejecutar:

* tests específicos;
* typecheck;
* lint;
* build cuando corresponda;
* contract tests;
* integración;
* E2E cuando corresponda;
* security gates;
* validación completa antes de mergear.

## 5.7 Adversarial review

Antes del merge debe revisar:

* correctness;
* seguridad;
* backward compatibility;
* scope creep;
* errores silenciosos;
* failure paths;
* cleanup;
* secretos;
* paths;
* red;
* proceso y cancelación;
* observabilidad;
* tests faltantes;
* documentación;
* contradicciones con ADRs.

Los findings se clasifican como:

* blocker;
* critical;
* major;
* minor;
* observation.

No puede mergearse con blockers o criticals abiertos.

Los majors deben corregirse o quedar explícitamente aceptados con justificación técnica y riesgo residual bajo control.

## 5.8 Decide

Claude Code puede mergear autónomamente cuando:

* la spec está satisfecha;
* CI está verde;
* tests relevantes pasan;
* no quedan blockers;
* no quedan criticals;
* los majors están corregidos o justificados;
* la PR es coherente;
* no se han debilitado gates;
* no se atraviesa una frontera externa prohibida.

## 5.9 Integrate

Estrategia predeterminada:

* squash merge;
* mensaje semántico;
* eliminación de rama;
* fast-forward local de `main`;
* verificación post-merge;
* CI de `main`;
* working tree limpio.

## 5.10 Record

Cada loop debe registrar:

* objetivo;
* base SHA;
* rama;
* commit;
* PR;
* merge SHA;
* archivos;
* tests;
* findings;
* decisiones;
* riesgos;
* estado final;
* siguiente objetivo.

---

# 6. Continuidad entre sesiones y context windows

Claude Code debe asumir que cualquier sesión puede terminar.

El proyecto no puede depender de la memoria del chat.

Debe mantener como mínimo:

```text
docs/context/TRIFORGE_PROJECT_VISION.md
docs/context/TRIFORGE_EXECUTION_STATE.md
docs/context/TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md
docs/context/TRIFORGE_RISK_REGISTER.md
```

Puede adaptar las rutas a las convenciones reales.

## 6.1 Execution State

Debe contener exclusivamente estado operativo actual:

* último milestone cerrado;
* milestone activo;
* PR abiertas;
* blockers;
* decisiones pendientes;
* SHA de `main`;
* última CI;
* siguiente loop;
* elementos `UNKNOWN`;
* elementos `REQUIRES_VERIFICATION`.

No debe convertirse en un diario infinito.

## 6.2 Risk Register

Cada riesgo debe incluir:

* ID;
* descripción;
* impacto;
* probabilidad cualitativa;
* mitigación;
* estado;
* owner;
* milestone responsable;
* evidencia.

## 6.3 Session rollover

Antes de agotar contexto:

1. Finalizar o estabilizar el cambio actual.
2. No dejar cambios sin identificar.
3. Persistir estado.
4. Registrar comandos necesarios para continuar.
5. Registrar PR y CI.
6. Indicar el siguiente loop exacto.
7. Crear un prompt de continuación si resulta necesario.

---

# 7. Política de ramas y pull requests

## 7.1 Una rama por unidad de trabajo

Formato orientativo:

```text
docs/<topic>
feat/<topic>
fix/<topic>
test/<topic>
security/<topic>
refactor/<topic>
```

## 7.2 Tamaño

Cada PR debe ser lo bastante pequeña para poder:

* comprender su intención;
* revisar el diff;
* verificar sus tests;
* revertirla;
* atribuir sus regresiones.

## 7.3 Draft y ready

Claude Code puede:

* abrir en draft mientras trabaja;
* actualizar la descripción;
* marcar ready cuando esté completa;
* mergear cuando los gates sean satisfactorios.

## 7.4 Merge policy

Predeterminado:

```text
squash merge
```

Excepciones justificables:

* preservar commits de una migración compleja;
* vendor import controlado;
* historial técnico útil.

## 7.5 Post-merge

Después de cada merge:

* verificar `main`;
* verificar CI;
* comprobar que la rama fue eliminada;
* comprobar ausencia de archivos locales inesperados;
* actualizar Execution State;
* seleccionar el siguiente loop.

---

# 8. Política de fallos y recuperación

## 8.1 CI fallida

No mergear.

El loop pasa a:

```text
Diagnose
    ↓
Reproduce
    ↓
Repair
    ↓
Re-run
```

## 8.2 Regresión después del merge

Prioridad inmediata:

1. Confirmar regresión.
2. Determinar blast radius.
3. Elegir fix-forward o revert.
4. Restaurar `main`.
5. Registrar causa.
6. Añadir test que prevenga recurrencia.

## 8.3 Cambio bloqueado

Cuando una tarea requiera una acción externa prohibida:

* marcarla como blocked;
* preservar evidencia;
* documentar exactamente qué falta;
* continuar con trabajo independiente.

## 8.4 Incertidumbre arquitectónica

Claude Code decide utilizando este orden:

1. Invariantes de seguridad.
2. Specs.
3. Acceptance criteria.
4. Código real.
5. Tests.
6. ADRs vigentes.
7. Compatibilidad.
8. Simplicidad.
9. Reversibilidad.
10. Rendimiento.
11. Preferencia estética.

Si dos opciones siguen siendo equivalentes, elegir la más simple y reversible.

---

# 9. Estado inicial del programa autónomo

Estado conocido antes de iniciar los loops:

```text
A0.1 Quota-Aware Provider Orchestration
Status: merged

A0.2 Canonical Project Vision
Status: merged

A0.3 Official CLI Integration and Local Authentication
Status: merged
Main SHA after merge: 823ab58

A0.4 Windows and WSL2 Execution Substrate
Status: implemented in draft PR #31
Head: 1cf37de
CI: success
Merge: pending

A0.5 Provider and Repository Threat Model
Status: pending
```

Antes de confiar en este estado, Claude Code debe verificar Git y GitHub.

---

# 10. Loop inicial obligatorio

## Loop 0: cerrar A0.4

1. Verificar PR #31.
2. Revisar el diff.
3. Confirmar docs-only.
4. Confirmar CI verde.
5. Corregir cualquier defecto real.
6. Marcar ready.
7. Squash-merge.
8. Eliminar rama.
9. Actualizar `main`.
10. Verificar CI de `main`.
11. Actualizar Execution State.

No debe volver a pedir permiso para este merge.

---

# 11. Governance Transition Loop

Después de A0.4 debe ejecutarse una unidad documental específica:

```text
Autonomous Loop Governance
```

Entregables:

1. Charter de gobernanza autónoma.
2. ADR con la transferencia de autoridad.
3. Actualización de Project Vision.
4. Sustitución de “human mandatory approval” por “human override”.
5. Política de auto-merge.
6. Hard stops externos.
7. Política de recuperación.
8. Política de continuidad entre sesiones.
9. Métricas del experimento.

El ADR debe explicar:

* decisión anterior;
* nueva autorización;
* razones;
* riesgos;
* mitigaciones;
* consecuencias;
* condiciones para revocar autonomía;
* acciones que continúan prohibidas.

Esta PR puede ser mergeada autónomamente tras validación.

---

# 12. A0.5: Provider and Repository Threat Model

Objetivo:

Definir amenazas antes de permitir ejecución real writable.

Debe cubrir:

* prompt injection;
* repositorios hostiles;
* README maliciosos;
* comentarios hostiles;
* scripts de tests maliciosos;
* symlink escape;
* path traversal;
* hardlinks;
* Git hooks;
* `.gitattributes`;
* Git config;
* submodules;
* package scripts;
* dependency confusion;
* environment leakage;
* exfiltración;
* comandos destructivos;
* procesos huérfanos;
* output spoofing;
* eventos falsificados;
* quota exhaustion;
* artifact poisoning;
* context poisoning;
* manipulación de tests;
* modificación de CI;
* approval spoofing;
* version drift;
* provider compromise;
* host compromise.

Entregables:

* threat model;
* activos;
* actores;
* trust boundaries;
* data flows;
* amenazas con IDs;
* severidades;
* mitigaciones;
* controles actuales;
* controles planeados;
* riesgos residuales;
* prohibited actions;
* security acceptance tests futuros;
* ADR de fronteras no confiables si no existe.

Criterio de cierre:

Toda capacidad writable futura debe estar ligada a:

* amenaza;
* control;
* milestone;
* verificación;
* recovery;
* riesgo residual.

A0.5 debe mergearse antes de implementar adapters writable.

---

# 13. A1: Provider Contracts

## A1.1 ProviderAdapter

Debe definir:

```ts
interface ProviderAdapter {
  checkAvailability(): Promise<AvailabilityResult>;
  checkAuthentication(): Promise<AuthenticationResult>;
  getCapabilities(): Promise<ProviderCapabilities>;
  execute(request: AgentExecutionRequest): AsyncIterable<ProviderEvent>;
  cancel(executionId: string): Promise<void>;
}
```

Debe incluir:

* provider ID;
* version;
* availability;
* authentication state;
* capabilities;
* request;
* event stream;
* result;
* error taxonomy;
* timeout;
* cancellation;
* usage;
* quota;
* sanitized arguments;
* raw evidence references.

## A1.2 ProviderEvent

Eventos mínimos:

```text
run.started
authentication.updated
agent.message
plan.updated
tool.started
tool.completed
file.changed
usage.updated
quota.updated
approval.requested
warning.raised
run.failed
run.completed
```

Debe incluir:

* schema version;
* timestamp;
* execution ID;
* provider;
* sequence number;
* payload;
* raw evidence reference;
* terminal event semantics.

## A1.3 Capability snapshots

Debe registrar:

* CLI version;
* verifiedAt;
* headless support;
* structured output;
* event stream;
* auth probe;
* usage;
* quota;
* read-only;
* write;
* cancellation;
* resume;
* unknown capabilities.

Una versión nueva invalida el snapshot anterior.

## A1.4 Artifact contracts

Contratos mínimos:

* `TaskSpecification`
* `ContextManifest`
* `AgentPlan`
* `CrossReview`
* `StrategyDecision`
* `TaskProfile`
* `RoutingDecision`
* `ImplementationResult`
* `ReviewFindings`
* `QualityGateResult`
* `GovernanceDecision`
* `RunFinalReport`

Todos deben validarse mediante Zod.

Cierre de A1:

* contratos compilando;
* sin lógica específica de provider;
* tests de schemas;
* compatibility rules;
* documentación actualizada.

---

# 14. A2: Mocks, Harness and Quota Manager

## A2.1 Mock providers

Crear:

* MockCodexAdapter;
* MockClaudeAdapter.

Escenarios:

* success;
* auth required;
* auth expired;
* timeout;
* cancellation;
* crash;
* partial output;
* malformed event;
* duplicate event;
* sequence gap;
* quota warning;
* quota exhausted;
* rate limit;
* tool use;
* file change;
* structured result;
* reviewer write attempt;
* orphan process simulation;
* output flood.

## A2.2 Adapter Harness

Debe verificar como caja negra:

* `run.started`;
* sequence ordering;
* único terminal event;
* timeout;
* cancellation;
* cleanup;
* auth;
* quota;
* output limits;
* partial preservation;
* no secret leakage;
* normalized errors;
* malformed event handling.

## A2.3 Quota Manager

Debe soportar:

* presupuestos por proveedor;
* reservas;
* warnings;
* hard stops;
* unknown state;
* rate-limit state;
* máximo de turnos;
* máximo de loops;
* máximo de wall time;
* manual resume;
* no paid fallback.

Cierre de A2:

Toda la orquestación debe poder probarse sin ejecutar Codex o Claude reales.

---

# 15. A3: Real Read-Only Adapters

## A3.1 Codex adapter

Funciones:

* detect availability;
* detect version;
* auth probe;
* headless execution;
* event stream;
* stdout/stderr;
* timeout;
* cancel;
* structured result;
* usage;
* quota when observable;
* unknown when not observable.

## A3.2 Claude adapter

Funciones equivalentes.

Restricciones:

* sin `--bare`;
* sin API keys;
* sin token extraction;
* sin automatizar login;
* sin escritura;
* sin acceso fuera del workspace.

## A3.3 Event normalizers

```text
Codex raw events
    ↓
CodexEventNormalizer
    ↓
ProviderEvent
```

```text
Claude raw events
    ↓
ClaudeEventNormalizer
    ↓
ProviderEvent
```

Debe conservar:

* orden;
* timestamps;
* raw evidence;
* parse errors;
* unknown events;
* version.

## A3.4 Smoke tests reales

Ejecutar ambos providers sobre fixtures read-only controlados.

Cierre de A3:

* ambos detectados;
* auth observable sin credenciales;
* ejecución read-only;
* eventos normalizados;
* cancelación;
* timeout;
* resultado estructurado;
* evidence retention.

---

# 16. A4: Collaboration Runtime

## A4.1 Specialist Mode

Modo predeterminado.

```text
Task
    ↓
Task Profile
    ↓
Owner Selection
    ↓
Plan
    ↓
Execution
```

El segundo provider solo participa cuando el riesgo o la política lo exijan.

## A4.2 Pair Mode

```text
Owner proposal
    ↓
Second-provider critique
    ↓
Resolution
    ↓
Owner execution
```

## A4.3 Full Debate Mode

```text
Independent plans
    ↓
Cross-review
    ↓
Agreements and disagreements
    ↓
Evidence-based resolution
```

Solo para:

* arquitectura;
* seguridad;
* migraciones;
* alto blast radius;
* incertidumbre elevada.

## A4.4 Review protocol

Los findings deben contener:

* severity;
* category;
* file;
* line;
* evidence;
* impact;
* required action;
* missing test;
* confidence.

## A4.5 Strategy resolution

Orden de autoridad:

1. Safety invariants.
2. Spec.
3. Acceptance criteria.
4. Code evidence.
5. Tests.
6. ADRs.
7. Threat model.
8. Risk policy.
9. Governance decision.

No decidir por mayoría de agentes.

Cierre de A4:

TriForge puede coordinar planificación, crítica, resolución y revisión entre providers sin escritura real.

---

# 17. A5: Controlled Writable Execution

No comenzar hasta cerrar:

* A0.4;
* Governance Transition;
* A0.5;
* A1;
* A2;
* A3;
* A4.

## A5.1 Worktree Manager

Cada implementación ocurre en un worktree aislado.

Debe soportar:

* creación;
* branch;
* ownership;
* lifecycle;
* cleanup;
* stale detection;
* recovery;
* disk limits;
* crash recovery;
* auditability.

Nunca trabajar directamente sobre `main`.

## A5.2 Owner and reviewer enforcement

Owner:

* puede escribir en paths autorizados;
* puede ejecutar comandos permitidos;
* puede crear tests;
* puede producir diff.

Reviewer:

* read-only;
* puede analizar;
* puede ejecutar validaciones seguras;
* produce findings;
* no modifica archivos.

## A5.3 Allowed paths

Contrato mínimo:

```json
{
  "readPaths": [],
  "writePaths": [],
  "blockedPaths": [],
  "maxFilesChanged": 0
}
```

Bloqueados por defecto:

* `.git`;
* credential stores;
* home del usuario;
* paths externos;
* producción;
* configuración global;
* secretos;
* otros worktrees.

Debe utilizar:

* normalización;
* realpath;
* containment;
* symlink checks;
* nonexistent ancestor validation;
* TOCTOU mitigation.

## A5.4 Safe Command Policy

Categorías:

```text
read_only
test
build
write_local
network
destructive
privileged
blocked
```

La shell debe estar deshabilitada por defecto.

Usar:

* binario explícito;
* argumentos separados;
* cwd explícito;
* environment allowlist;
* timeout;
* output limits;
* process ownership.

## A5.5 Process supervision

Debe soportar:

```text
cancel requested
    ↓
stop new work
    ↓
SIGTERM owned process group
    ↓
grace period
    ↓
SIGKILL remaining processes
    ↓
collect partial evidence
    ↓
single terminal event
```

## A5.6 Mutation ledger

Registrar:

* archivos creados;
* modificados;
* eliminados;
* hashes before/after;
* comandos;
* timestamps;
* owner;
* diff;
* tests;
* reasons.

## A5.7 Quality Gate Runner

Gates:

* unit tests;
* integration tests;
* E2E;
* typecheck;
* lint;
* build;
* dependency checks;
* security;
* Code Graph;
* custom harness.

## A5.8 Repair loop

```text
Implement
    ↓
Quality gates
    ↓
Reviewer findings
    ↓
Repair
    ↓
Quality gates
```

Con límites:

* rounds;
* quota;
* wall time;
* output;
* failure threshold.

## A5.9 Autonomous integration gate

Sustituye al antiguo Human Commit Gate.

Antes de mergear debe existir un `GovernanceDecision` con:

* task;
* spec;
* owner;
* reviewer;
* context;
* diff hash;
* tests;
* findings;
* quota;
* risks;
* merge decision;
* justification.

## A5.10 Writable E2E

Probar en fixture:

* crear worktree;
* implementar feature;
* tests;
* review;
* repair;
* governance decision;
* commit;
* merge controlado;
* cleanup.

Cierre de A5:

TriForge completa una tarea real de bajo riesgo, con owner único, reviewer read-only, tests, repair y merge gobernado.

Este es el MVP funcional.

---

# 18. A6: Routing and Learning

## A6.1 Task Profiler

Clasificar:

* task kind;
* complexity;
* risk;
* blast radius;
* framework;
* reasoning depth;
* repetition;
* test burden;
* security sensitivity;
* behavioral preservation.

## A6.2 Static router

Reglas iniciales basadas en evidencia, no dogma.

Claude puede favorecer tareas como:

* refactors;
* invariantes;
* razonamiento multiarchivo;
* revisión adversarial;
* bugs lógicos.

Codex puede favorecer:

* contratos tipados;
* implementaciones estructuradas;
* frameworks comunes;
* transformaciones repetitivas;
* interfaces.

Estas preferencias deben medirse y revisarse.

## A6.3 Quota-aware routing

Combinar:

```text
capability
+ quota
+ risk
+ availability
+ repository performance
+ confidence
```

## A6.4 Metrics

Registrar:

* owner;
* reviewer;
* task type;
* first-pass success;
* repair rounds;
* findings;
* regressions;
* wall time;
* quota;
* merge success;
* rollback;
* failure reason.

## A6.5 Repository profiles

El aprendizaje se limita inicialmente al repositorio actual.

## A6.6 Adaptive router

Solo activar con:

* muestra suficiente;
* confidence;
* fallback;
* protections against sparse data;
* auditability.

---

# 19. A7: Competitive Mode

Dos soluciones aisladas:

```text
Task
  ├── Codex worktree
  └── Claude worktree
          ↓
     Common harness
          ↓
 Comparative evidence
          ↓
 Governance selection
```

Requisitos:

* opt-in por política;
* presupuesto suficiente;
* mismo contexto;
* mismos acceptance criteria;
* worktrees separados;
* sin acceso mutuo inicial;
* comparación objetiva.

No es obligatorio para el MVP.

---

# 20. A8: Product Interface

## Provider Status

Mostrar:

* installed;
* version;
* auth;
* capabilities;
* quota;
* unknown states;
* last verified.

## Task Composer

Permitir:

* objective;
* constraints;
* acceptance criteria;
* risk;
* mode;
* budget;
* allowed paths.

## Run Timeline

Mostrar:

* provider events;
* plans;
* tools;
* commands;
* file changes;
* warnings;
* quota;
* failures;
* completion.

## Artifact Explorer

Mostrar:

* context;
* plans;
* reviews;
* decisions;
* routing;
* tests;
* final reports.

## Diff and Review

Mostrar:

* file tree;
* diff;
* findings;
* tests;
* repair rounds;
* owner;
* reviewer.

## Governance Dashboard

Mostrar:

* strategy decision;
* command decisions;
* autonomous merge decision;
* blocked actions;
* overrides;
* rollback;
* cancel.

## Budget Panel

Mostrar:

* configured budget;
* consumed;
* reserved;
* known;
* estimated;
* unknown;
* resetsAt only when reliable.

---

# 21. A9: Hardening and Release

## Failure testing

* provider crash;
* malformed events;
* auth expiry;
* quota exhaustion;
* timeout;
* cancellation;
* orphan process;
* disk full;
* worktree corruption;
* test hang;
* output flood;
* unknown CLI version;
* runtime restart;
* DB outage.

## Security validation

* prompt injection;
* symlink escape;
* path traversal;
* environment leakage;
* secret leakage;
* command injection;
* unauthorized write;
* network exfiltration;
* Git hooks;
* package scripts;
* context poisoning;
* artifact tampering;
* approval hash mismatch;
* reviewer write attempt;
* main write attempt.

## Version drift

* CLI update detection;
* capability invalidation;
* compatibility matrix;
* unsupported state;
* revalidation;
* rollback.

## Recovery

* resume;
* cancel;
* cleanup;
* artifact recovery;
* auth recovery;
* quota recovery;
* repair abandonment;
* worktree recovery.

## Observability

Structured logs:

* run ID;
* provider;
* task;
* events;
* commands;
* decisions;
* quota;
* timings;
* failures;
* merge;
* rollback.

Sin secretos.

## Packaging

Definir:

* WSL2 prerequisites;
* Node;
* pnpm;
* PostgreSQL;
* Codex;
* Claude Code;
* manual login;
* diagnostics;
* install;
* update;
* uninstall;
* cleanup.

## Documentation

* installation;
* quick start;
* provider setup;
* security model;
* autonomous governance;
* quota guide;
* troubleshooting;
* architecture;
* contribution;
* recovery;
* release notes.

## Release candidate

Ejecutar:

* feature;
* bug fix;
* refactor;
* tests;
* docs;
* security rejection;
* quota stop;
* auth expiry;
* provider crash;
* review finding;
* autonomous merge;
* rollback;
* recovery.

---

# 22. Definition of Done de TriForge 1.0

TriForge 1.0 está terminado cuando:

## Providers

* Codex CLI integrado.
* Claude Code integrado.
* Version detection.
* Auth detection.
* Capability snapshots.
* Event streams.
* Cancellation.
* Timeout.
* Usage.
* Quota when observable.
* Unknown when not observable.

## Security

* Sin API keys.
* Sin token extraction.
* Sin cookies.
* Sin login automático.
* Workspace boundaries.
* Worktree isolation.
* Owner único.
* Reviewer read-only.
* Allowed paths.
* Safe commands.
* Process groups.
* Threat model.
* Security tests.
* Secret redaction.
* Audit trail.

## Context

* Context Engine.
* Code Graph.
* Context Packs.
* Provenance.
* Retention.
* Redaction.
* Context gates.
* Prompt injection treatment.
* Cross-run isolation.

## Collaboration

* Specialist.
* Pair.
* Full Debate.
* Cross-review.
* Strategy resolution.
* Repair.
* Governance decisions.
* Artifact persistence.

## Writable execution

* Worktree manager.
* Diff capture.
* Mutation ledger.
* Quality gates.
* Cleanup.
* Rollback.
* Autonomous merge gate.
* No direct main writes.

## Quota

* Budgets.
* Reservations.
* Hard stops.
* Warnings.
* Rate limits.
* Unknown state.
* Resume.
* No paid fallback.

## Routing

* Task profiles.
* Static routing.
* Quota-aware routing.
* Metrics.
* Repository profiles.
* Adaptive routing with confidence.

## Product

* Task creation.
* Provider status.
* Timeline.
* Artifacts.
* Diff.
* Findings.
* Governance UI.
* Recovery.
* Installation.

## Quality

* CI verde.
* Unit tests.
* Integration tests.
* Adapter contract tests.
* E2E.
* Security tests.
* Chaos tests.
* No known critical vulnerabilities.
* No open blockers.
* Documentation current.
* Reproducible installation.

## Governance experiment

* Autonomous decisions auditable.
* Cada merge ligado a evidencia.
* Métricas de autonomía disponibles.
* Rollbacks registrados.
* Human override funcional.
* Ninguna frontera externa prohibida cruzada.
* Estado recuperable después de context loss.

---

# 23. Métricas del experimento autónomo

Registrar por milestone y globalmente:

* loops ejecutados;
* PR creadas;
* PR mergeadas;
* CI failures;
* repair rounds;
* regressions;
* reverts;
* blockers;
* human interventions;
* findings por severidad;
* tiempo hasta merge;
* tamaño de diff;
* cobertura;
* quota usage;
* decisiones revertidas;
* incidentes de seguridad;
* context recoveries.

El objetivo no es demostrar que el agente nunca falla.

El objetivo es demostrar que:

* detecta fallos;
* los limita;
* conserva evidencia;
* repara;
* revierte;
* aprende;
* puede continuar sin perder el estado canónico.

---

# 24. Regla de ejecución continua

Claude Code debe continuar seleccionando y ejecutando loops mientras exista trabajo desbloqueado.

No debe detenerse únicamente porque haya completado una PR.

Después de cada merge:

```text
Verify main
    ↓
Update state
    ↓
Inspect roadmap
    ↓
Select next unlocked objective
    ↓
Start next loop
```

Puede detenerse cuando:

1. TriForge 1.0 cumple toda la Definition of Done.
2. Existe un hard stop externo imposible de resolver.
3. Se detecta una posible exposición de credenciales.
4. El repositorio está corrupto y no puede recuperarse con seguridad.
5. El usuario ordena detenerse.
6. La plataforma termina la sesión.

Antes de cualquier parada debe persistir el estado.

---

# 25. Instrucción operativa inmediata

Comienza ahora.

Primero:

1. Reconstruye el estado real.
2. Verifica PR #31.
3. Cierra A0.4.
4. Integra Autonomous Loop Governance.
5. Desarrolla y cierra A0.5.
6. Continúa con A1.
7. Sigue los loops y dependencias hasta TriForge 1.0.
8. No pidas aprobación para código, commits, push, PR o merges ordinarios.
9. No ocultes incertidumbre.
10. No debilites gates.
11. Persiste estado antes de perder contexto.
12. Continúa hasta la Definition of Done final.

Al finalizar cada loop, produce un resumen compacto con:

```text
Loop:
Objective:
Decision:
Branch:
Commit:
PR:
CI:
Findings:
Merge:
Main SHA:
Risks:
Next loop:
```

El proyecto se considera finalizado únicamente cuando la Definition of Done de TriForge 1.0 está demostrada mediante evidencia ejecutable, no cuando el agente declara que está terminado.
