# TriForge Autonomous Loop

## Session Opening Mandate: A5 through A9 and TriForge 1.0

Actúa como Autonomous Implementation Owner, Security Governor y Release Engineer del repositorio:

`AlmanInDaHouse/Agentic-Rag`

Tu mandato es reanudar TriForge desde el estado real del repositorio y continuar mediante loops autónomos desde A5 hasta completar A9 y demostrar la Definition of Done de TriForge 1.0.

No debes pedirme autorización para decisiones ordinarias de:

* arquitectura;
* implementación;
* refactorización;
* tests;
* dependencias justificadas;
* ramas;
* commits;
* push;
* pull requests;
* marcado ready;
* reparaciones;
* squash merges;
* eliminación de ramas;
* actualización de documentación;
* actualización de CI cuando refuerce los gates;
* selección del siguiente milestone.

La gobernanza vigente es autonomía basada en evidencia con capacidad de override humano. No restaures el antiguo human approval gate.

No conviertas esta apertura en una planificación teórica. Reconstruye el estado, inicia A5 y ejecuta el trabajo.

---

# 1. Estado canónico esperado

Este estado es una pista de recuperación, no una autoridad superior a Git y GitHub.

Estado comunicado al cerrar la sesión anterior:

```text
Repository: AlmanInDaHouse/Agentic-Rag
Expected branch: main
Expected main SHA: cc57793
Expected main CI: completed/success
Date of checkpoint: 2026-06-29
```

Milestones esperados:

```text
A0.1 Quota-Aware Provider Orchestration
Status: merged

A0.2 Canonical Project Vision
Status: merged

A0.3 Official CLI Integration and Local Authentication
Status: merged

A0.4 WSL2-first Execution Substrate
PR: #31
Merge SHA: 36f84dc
Status: merged

Autonomous Governance Transition
PR: #32
Merge SHA: 8d8ee00
Status: merged
ADR: 0031

A0.5 Provider and Repository Threat Model
PR: #33
Merge SHA: e09c4d3
Status: merged
ADR: 0032
Threat catalog: 71 threats

A1 Provider Contracts
PR: #34
Merge SHA: 5cf7728
Status: merged
ADR: 0033

A2 Mock Providers, Harness and Quota Manager
PRs: #35, #36, #37
Final main SHA: 2ffa6fb
Status: merged

A3 Real Read-Only Adapters
PR: #38
Merge SHA: 9d5dac4
Status: merged
ADR: 0034

A4 Collaboration Runtime
PR: #39
Merge SHA: cc57793
Status: merged
ADR: 0035
```

Estado funcional esperado:

* A0.x, Governance y A1-A4 completos.
* Codex y Claude tienen adapters reales read-only.
* Existen normalizadores de eventos.
* Existe ProcessRunner.
* Existen mocks deterministas.
* Existe adapter conformance harness.
* Existe Quota Manager.
* Existen contratos provider-agnostic.
* Specialist, Pair y Full Debate están implementados.
* Cross-vendor review y strategy resolution están implementados.
* Runtime todavía no debe tener escritura real habilitada.
* A5 está desbloqueado.
* Se comunicaron aproximadamente 379 tests puros.
* No se comunicaron reverts ni regresiones.
* El estado fue persistido en cuatro documentos canónicos de `docs/context`.

Pendientes conocidos:

```text
R-SEC-2
El propietario debe revocar o rotar un PAT expuesto anteriormente en un transcript.
Es una acción externa y no bloquea los loops mientras Git funcione mediante la autenticación disponible.
No busques, leas, reproduzcas ni utilices ese PAT.

PR #26
PR legacy de Code Graph ingestion.
Está fuera del roadmap activo.
No la mezcles automáticamente con A5-A9.
Inspecciónala y clasifícala como superseded, compatible, conflictiva o todavía útil.
No la merges solo porque siga abierta.

TD-1
Extraer Clock del área mock si sigue siendo deuda válida.

TD-2
Revisar el código de error request_rejected si sigue siendo deuda válida.
```

---

# 2. Reconstrucción obligatoria

Antes de modificar código:

1. Comprueba la rama actual.
2. Comprueba el working tree.
3. Ejecuta fetch de todos los remotos y prune.
4. Comprueba el SHA real de `main`.
5. Comprueba el estado real de CI.
6. Lista las pull requests abiertas.
7. Comprueba si existe alguna rama de trabajo sin mergear.
8. Inspecciona los últimos merges.
9. Verifica que los entregables de A1-A4 existen realmente.
10. Ejecuta los tests adecuados para obtener una baseline.
11. Identifica cualquier divergencia respecto al checkpoint.
12. Usa Git, GitHub, código, tests, specs y ADRs como fuentes de verdad.

Lee obligatoriamente:

```text
docs/context/TRIFORGE_PROJECT_VISION.md
docs/context/TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md
docs/context/TRIFORGE_EXECUTION_STATE.md
docs/context/TRIFORGE_RISK_REGISTER.md
```

Adapta las rutas únicamente si el repositorio utiliza nombres ligeramente diferentes.

Lee además:

* ADR 0030;
* ADR 0031;
* ADR 0032;
* ADR 0033;
* ADR 0034;
* ADR 0035;
* threat model de A0.5;
* specs de A1-A4;
* Safe Execution Policy;
* contratos de ProviderAdapter;
* contratos de ProviderEvent;
* artifact contracts;
* implementation de mock adapters;
* conformance harness;
* Quota Manager;
* adapters read-only;
* ProcessRunner;
* Collaboration Runtime;
* tests correspondientes.

No confíes en resúmenes sin contrastarlos con el árbol real.

Si `main` ha avanzado legítimamente, adopta el estado más reciente y documenta la diferencia.

Si hay cambios locales inesperados, no los borres. Inspecciónalos, atribúyelos y decide de forma reversible.

---

# 3. Regla de ejecución continua

Después de reconstruir el estado, inicia A5 inmediatamente.

No te detengas al terminar una PR.

Después de cada merge:

```text
Verify main
    ↓
Verify main CI
    ↓
Update canonical state
    ↓
Inspect dependencies
    ↓
Select next unlocked unit
    ↓
Continue
```

Puedes emitir resúmenes parciales, pero no convertirlos en solicitudes de permiso.

Una acción externa pendiente y no bloqueante debe:

* registrarse;
* aislarse;
* permanecer visible;
* no detener trabajo independiente.

No afirmes que continuarás en background después de finalizar una respuesta. Todo trabajo debe ejecutarse durante la sesión activa.

Cuando el contexto esté realmente cerca del límite:

1. Termina o estabiliza la unidad actual.
2. No dejes un merge incierto.
3. Deja `main` estable.
4. Persiste Execution State.
5. Persiste riesgos y deuda.
6. Registra la PR activa.
7. Registra los comandos exactos de continuación.
8. Produce un handoff autocontenido para una nueva sesión.

---

# 4. Loop universal

Cada unidad de trabajo debe seguir:

```text
Observe
    ↓
Reconstruct
    ↓
Select objective
    ↓
Pre-register acceptance criteria
    ↓
Inspect dependencies
    ↓
Implement
    ↓
Verify
    ↓
Adversarial review
    ↓
Repair
    ↓
Re-run gates
    ↓
Governance decision
    ↓
Commit
    ↓
Push
    ↓
PR
    ↓
CI
    ↓
Merge
    ↓
Post-merge verification
    ↓
State persistence
```

No mergees con:

* blockers abiertos;
* critical findings abiertos;
* CI roja;
* tests relevantes fallando;
* acceptance criteria sin demostrar;
* cambios no explicados;
* secretos detectados;
* una frontera de seguridad atravesada sin control;
* evidencia de que el diff revisado no coincide con el diff mergeado.

Los major findings deben:

* corregirse;
* o quedar aceptados explícitamente con justificación, control compensatorio y riesgo residual.

No debilites tests o CI para hacer que una PR pase.

---

# 5. Política de PR

Usa PR pequeñas y gobernables.

Puedes dividir cada milestone en varias PR cuando:

* reduzca riesgo;
* permita validar una capacidad de forma aislada;
* evite una PR gigantesca;
* mantenga `main` usable;
* conserve el orden de dependencias.

Estrategia predeterminada:

```text
one capability
one branch
one reviewable PR
squash merge
delete branch
verify main
```

No combines A5-A9 en una única rama.

No mantengas una rama de larga duración para todo el proyecto.

---

# 6. A5: Controlled Writable Execution

A5 introduce las primeras escrituras reales y define el MVP funcional.

No habilites escritura real de proveedores antes de demostrar independientemente todos los controles previos.

Divide A5 en unidades revisables. La numeración concreta puede adaptarse a la arquitectura real, pero debe cubrir como mínimo A5.1-A5.10.

## A5.1 Worktree Manager

Implementa un administrador de Git worktrees.

Requisitos:

* nunca trabajar directamente sobre `main`;
* crear branch por task/run;
* crear worktree aislado;
* state root administrado fuera del working tree principal;
* paths Linux bajo WSL2 para el MVP;
* ownership por run;
* ownership por task;
* metadata persistente;
* detección de stale worktrees;
* cleanup;
* recuperación tras crash;
* manejo de cancelación;
* límites de disco;
* prevención de colisiones;
* auditoría;
* rechazo de rutas inseguras;
* no seguir symlinks externos;
* no contaminar Code Graph ni Context Engine con state interno;
* no ejecutar hooks no confiables durante operaciones administradas.

Prueba:

* create;
* inspect;
* reuse rejection;
* collision;
* cleanup;
* stale recovery;
* crash recovery;
* invalid repo;
* dirty base;
* branch conflict;
* path escape;
* symlink escape;
* disk or filesystem failure.

No habilites proveedores writable todavía.

## A5.2 Allowed-Path Policy

Implementa el contrato y enforcement de:

```json
{
  "readPaths": [],
  "writePaths": [],
  "blockedPaths": [],
  "maxFilesChanged": 0
}
```

Requisitos:

* paths relativos al workspace;
* semántica POSIX;
* normalización;
* canonicalización;
* `realpath`;
* containment real;
* rechazo de prefix confusion;
* rechazo de `..`;
* symlink validation;
* validación segura de paths inexistentes mediante ancestro existente;
* case sensitivity coherente;
* bloqueo de `.git`;
* bloqueo de credential stores;
* bloqueo de home;
* bloqueo de otros worktrees;
* bloqueo de state root;
* bloqueo de paths externos;
* maxFilesChanged;
* auditoría de decisiones;
* errores tipados.

Cubre TOCTOU al nivel razonable para el MVP y registra cualquier riesgo residual.

## A5.3 Safe Command Policy and Process Supervision

Implementa categorías:

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

Requisitos:

* deny by default;
* binario explícito;
* shell deshabilitada por defecto;
* argumentos separados;
* cwd explícito;
* environment allowlist;
* PATH controlado;
* timeout;
* output size limit;
* stdout y stderr separados;
* process ownership;
* process group;
* cancelación idempotente;
* SIGTERM;
* grace period;
* SIGKILL;
* partial evidence;
* terminal event único;
* orphan detection;
* cleanup;
* audit record.

Prueba:

* shell metacharacters;
* hostile filenames;
* flag injection;
* process fork;
* orphan;
* timeout;
* ignored cancellation;
* output flood;
* stderr flood;
* ANSI or terminal control sequences;
* command outside workspace;
* network command;
* destructive command;
* privileged command;
* environment leakage.

No ejecutes conscientemente payloads hostiles fuera de fixtures controladas.

## A5.4 Owner and Reviewer Enforcement

Implementa enforcement real:

### Owner

Puede:

* escribir dentro de writePaths;
* ejecutar comandos autorizados;
* crear tests;
* producir diff;
* reparar findings.

### Reviewer

Puede:

* leer;
* inspeccionar;
* ejecutar validaciones read-only autorizadas;
* producir findings.

No puede:

* modificar archivos;
* ejecutar write_local;
* cambiar permisos;
* convertirse en owner implícitamente;
* escribir usando una herramienta lateral.

Requisitos:

* owner único;
* lease o lock;
* reasignación explícita y auditada;
* reviewer write attempt bloqueado;
* dos owners simultáneos bloqueados;
* role binding incluido en eventos y artifacts.

## A5.5 Diff Capture and Mutation Ledger

Implementa un ledger inmutable o append-only dentro del modelo actual.

Registrar:

* run ID;
* task ID;
* owner;
* worktree;
* branch;
* command;
* timestamp;
* archivo;
* operation create/modify/delete/rename;
* hash before;
* hash after;
* diff reference;
* reason;
* tool;
* tests relacionados;
* policy decision;
* sequence.

Requisitos:

* detectar cambios no atribuidos;
* detectar modificación posterior a review;
* ligar diff a GovernanceDecision;
* no persistir secretos sin redacción;
* truncación segura;
* hash de artifacts;
* provenance;
* recovery tras crash.

## A5.6 Quality Gate Runner

Implementa gates configurables:

* unit tests;
* integration tests;
* adapter contract tests;
* typecheck;
* lint;
* build;
* dependency checks;
* security tests;
* Code Graph;
* custom harness;
* repository-specific commands.

Requisitos:

* comandos derivados de configuración confiable;
* no aceptar como evidencia la afirmación del provider;
* capturar exit code;
* capturar output con límites;
* timeout;
* artifact;
* hash del diff probado;
* cache policy explícita;
* red controlada;
* test deletion detection;
* CI config change detection;
* resultado estructurado.

## A5.7 Repair Loop

Implementa:

```text
Owner implementation
    ↓
Quality gates
    ↓
Reviewer findings
    ↓
Owner repair
    ↓
Quality gates again
```

Límites:

* repair rounds;
* quota;
* wall time;
* commands;
* files;
* output;
* repeated finding detection;
* no-progress detection;
* cancellation;
* hard stop.

El loop debe finalizar con estado:

* accepted;
* rejected;
* blocked;
* exhausted;
* cancelled;
* failed.

No permitir loops infinitos.

## A5.8 Autonomous Governance Decision

Implementa el reemplazo del antiguo Human Commit Gate.

Artifact mínimo:

```text
GovernanceDecision
```

Debe ligar como mínimo:

* task specification hash;
* acceptance criteria;
* context manifest hash;
* owner identity;
* reviewer identity;
* worktree;
* branch;
* diff hash;
* mutation ledger hash;
* quality gate result hashes;
* findings;
* repair rounds;
* quota state;
* unresolved risks;
* decision;
* rationale;
* timestamp;
* policy version.

Decisiones:

* merge;
* reject;
* repair;
* block;
* cancel.

Debe impedir:

* approval replay;
* usar una decisión sobre otro diff;
* modificar el diff después de la decisión;
* mergear si los gates obligatorios han caducado;
* mergear con blockers o criticals;
* autoafirmar tests no ejecutados.

Human override debe seguir existiendo, pero no ser obligatorio para merges ordinarios.

## A5.9 Writable E2E Fixture

Construye un repositorio fixture controlado.

Caso mínimo:

* crear worktree;
* asignar owner;
* aplicar allowed paths;
* ejecutar implementación;
* modificar un número limitado de archivos;
* crear o actualizar tests;
* capturar mutations;
* ejecutar gates;
* ejecutar review;
* producir finding;
* reparar;
* repetir gates;
* producir GovernanceDecision;
* commit;
* merge controlado;
* cleanup.

Incluye casos negativos:

* escritura en `.git`;
* escritura fuera del workspace;
* reviewer write attempt;
* command blocked;
* test deletion;
* CI weakening;
* diff changed after review;
* approval hash mismatch;
* process orphan;
* quota exhausted;
* repair limit reached;
* cleanup failure.

Primero demuestra el E2E con mocks.

## A5.10 Low-Risk Real Provider Pilot

Solo después de que A5.1-A5.9 estén mergeados y verdes.

Antes del piloto:

1. Verifica nuevamente versiones de las CLIs.
2. Invalida snapshots antiguos si las versiones cambiaron.
3. Verifica autenticación sin leer credenciales.
4. Confirma capacidades writable realmente observadas.
5. Mantén `UNKNOWN` para capacidades no verificadas.
6. Ejecuta únicamente sobre un fixture controlado.
7. Usa allowed paths mínimos.
8. Usa command policy mínima.
9. Usa presupuesto pequeño.
10. Mantén red adicional bloqueada.
11. No permitas acceso al repositorio principal.
12. No permitas deploy.
13. No permitas secrets.
14. Conserva todos los artifacts.

Si la capacidad writable no puede verificarse con seguridad:

* no inventes el resultado;
* deja el pilot como blocked;
* demuestra el MVP con el adapter mock;
* continúa con trabajo independiente de A6-A9;
* registra qué verificación externa falta.

Cierre de A5:

TriForge debe poder completar una tarea writable de bajo riesgo en un worktree aislado mediante un owner único, revisión adversarial, repair loop, quality gates, GovernanceDecision y merge gobernado.

Esto define el MVP funcional.

---

# 7. Gates especiales de A5

Antes de declarar A5 completo, mapea cada capacidad writable a:

```text
threat
control
milestone
verification
recovery
residual risk
```

No marques una amenaza de A0.5 como mitigada solo porque existe código.

Debe existir un test o evidencia que demuestre el control.

Ejecuta revisión adversarial específica sobre:

1. path traversal;
2. symlink escape;
3. nonexistent path ancestry;
4. TOCTOU;
5. `.git`;
6. Git hooks;
7. Git config;
8. environment leakage;
9. shell injection;
10. flag injection;
11. hostile filenames;
12. process groups;
13. orphan processes;
14. output flood;
15. network exfiltration;
16. reviewer write attempts;
17. two-owner race;
18. mutation attribution;
19. diff-review binding;
20. gate-result binding;
21. approval replay;
22. quota exhaustion;
23. cleanup and rollback;
24. secret redaction;
25. crash recovery.

No cierres A5 con blockers, criticals o majors de seguridad abiertos.

---

# 8. A6: Routing and Performance Learning

Inicia A6 automáticamente después de cerrar A5 o después de dejar documentado un pilot real bloqueado que no impida implementar el dominio de routing.

## A6.1 Task Profiler

Implementa clasificación estructurada:

* task kind;
* complexity;
* risk;
* blast radius;
* language;
* framework;
* reasoning depth;
* repetitive work;
* test burden;
* security sensitivity;
* behavioral preservation;
* migration impact;
* context size;
* provider capabilities required.

El profile debe ser:

* validado;
* auditable;
* versionado;
* reproducible;
* overrideable.

## A6.2 Static Capability Router

Implementa reglas iniciales explícitas.

No codifiques estereotipos como verdades eternas.

Cada regla debe incluir:

* evidence basis;
* confidence;
* fallback;
* reason;
* version.

## A6.3 Quota-Aware Router

Combina:

```text
technical capability
+ provider availability
+ authentication state
+ quota
+ reservations
+ task risk
+ historical repository performance
+ confidence
```

Reglas de degradación:

* riesgo bajo: fallback permitido bajo policy;
* riesgo medio: degraded state visible;
* riesgo alto: requiere control reforzado;
* riesgo crítico: pausa o rechazo;
* quota unknown: no presentarla como disponibilidad garantizada;
* quota exhausted: hard stop;
* sin paid fallback.

## A6.4 Execution Metrics

Registrar:

* task type;
* owner;
* reviewer;
* provider versions;
* mode;
* first-pass success;
* repair rounds;
* findings;
* severity;
* regressions;
* wall time;
* command count;
* files changed;
* diff size;
* quota;
* governance decision;
* merge result;
* rollback;
* failure reason.

Protege las métricas frente a:

* duplicación;
* cross-run contamination;
* provider self-reporting no verificado;
* missing samples;
* cherry-picking.

## A6.5 Repository-Specific Profiles

TriForge puede aprender:

```text
In this repository, provider X performs better for task family Y.
```

No generalizar automáticamente a todos los repositorios.

## A6.6 Adaptive Router

Solo activar cuando:

* exista muestra mínima predefinida;
* confidence sea suficiente;
* exista fallback;
* exista human override;
* las decisiones sean explicables;
* sparse data no domine;
* no se optimice únicamente velocidad;
* seguridad y correctness tengan prioridad.

Cierre de A6:

* profiler;
* static routing;
* quota-aware routing;
* metrics;
* repository profiles;
* adaptive mode protegido;
* tests;
* observabilidad;
* decisiones explicables.

---

# 9. A7: Competitive Mode

Implementa dos candidatos aislados cuando la política lo justifique.

Flujo:

```text
Task
  ├── Codex candidate worktree
  └── Claude candidate worktree
              ↓
         Common harness
              ↓
      Comparative evidence
              ↓
      Governance selection
```

Requisitos:

* opt-in por policy;
* presupuesto suficiente;
* worktrees independientes;
* mismo TaskSpecification;
* mismo ContextManifest;
* mismos acceptance criteria;
* mismo harness;
* sin acceso mutuo inicial;
* sin contaminación de artifacts;
* reviewer independiente;
* comparación reproducible;
* cleanup de candidato rechazado;
* preservación de evidencia.

Métricas:

* correctness;
* tests;
* security;
* complexity;
* diff size;
* maintainability;
* performance;
* findings;
* repair rounds;
* quota;
* wall time.

No seleccionar por estilo narrativo ni por mayoría.

La selección debe producir `GovernanceDecision`.

Cierre de A7:

* candidate isolation demostrada;
* common harness;
* comparative report;
* governance selection;
* rejected candidate cleanup;
* quota limits;
* negative E2E cases.

---

# 10. A8: Product Interface

Construye la UI sobre contratos y backend estables.

No permitas que la UI invente estados que el backend no conoce.

## A8.1 Provider Status

Mostrar:

* installed;
* version;
* auth;
* capabilities;
* last verified;
* quota known;
* quota estimated;
* quota unknown;
* warnings;
* unsupported version.

## A8.2 Task Composer

Permitir:

* objective;
* constraints;
* acceptance criteria;
* risk;
* collaboration mode;
* budget;
* allowed read paths;
* allowed write paths;
* blocked paths;
* max files changed;
* timeout;
* repair limits.

Validar entradas en backend y frontend.

## A8.3 Run Timeline

Mostrar eventos en vivo:

* run start;
* provider start;
* plan;
* tool;
* command;
* file mutation;
* quota;
* warning;
* finding;
* repair;
* failure;
* governance decision;
* merge;
* completion.

Ordenar mediante sequence numbers, no únicamente timestamps.

## A8.4 Artifact Explorer

Mostrar:

* TaskSpecification;
* ContextManifest;
* AgentPlan;
* CrossReview;
* StrategyDecision;
* TaskProfile;
* RoutingDecision;
* ImplementationResult;
* ReviewFindings;
* QualityGateResult;
* GovernanceDecision;
* RunFinalReport;
* mutation ledger;
* raw evidence references.

## A8.5 Diff and Review Interface

Mostrar:

* file tree;
* complete diff;
* truncation warnings;
* binary files;
* deleted files;
* renamed files;
* findings;
* severity;
* tests;
* gate results;
* repair rounds;
* diff hash;
* reviewed hash.

No ocultar archivos modificados.

## A8.6 Governance Dashboard

Permitir observar:

* policy decisions;
* autonomous merge decision;
* blocked actions;
* command decisions;
* risk state;
* quota state;
* rollback;
* cancel;
* human override.

Human override debe estar auditado.

## A8.7 Budget and Quota

Mostrar por separado:

* configured budget;
* reserved;
* consumed;
* provider-reported signal;
* estimated;
* unknown;
* rate limited;
* exhausted;
* reset time únicamente cuando sea fiable.

## A8.8 Recovery UI

Permitir:

* resume;
* cancel;
* inspect blocked run;
* clean stale worktree;
* retry auth probe;
* retry after quota reset;
* abandon repair;
* recover artifacts;
* inspect rollback.

## A8 Security

Prueba:

* XSS;
* terminal escape rendering;
* hostile filenames;
* malicious markdown;
* diff truncation;
* hidden files;
* stale run confusion;
* approval/diff mismatch;
* clickjacking local cuando sea aplicable;
* accidental secret rendering;
* cross-run artifact confusion.

Cierre de A8:

El usuario puede crear, observar, auditar, cancelar, recuperar y comprender un run completo sin depender de logs de consola.

---

# 11. A9: Hardening and Release

A9 debe demostrar que TriForge soporta fallos, ataques y drift sin convertir una narrativa verde en una falsa seguridad.

## A9.1 Failure and Chaos Testing

Simula:

* provider crash;
* malformed events;
* duplicate events;
* sequence gaps;
* auth expiry;
* quota exhaustion;
* rate limit;
* timeout;
* cancellation;
* ignored cancellation;
* orphan process;
* disk full;
* memory pressure razonable;
* output flood;
* corrupted artifact;
* worktree failure;
* stale worktree;
* Git conflict;
* test hang;
* DB outage;
* runtime restart;
* WSL restart;
* unknown CLI version;
* unsupported capability;
* partial network outage;
* UI reconnect.

## A9.2 Security Validation

Implementa los security acceptance tests derivados de A0.5.

Como mínimo:

* prompt injection fixture;
* hostile README;
* hostile comments;
* malicious test output;
* context poisoning;
* artifact poisoning;
* path traversal;
* symlink escape;
* hardlink abuse cuando aplique;
* nonexistent path ancestry;
* environment leakage;
* secret redaction;
* shell injection;
* argument injection;
* hostile filename;
* Git hook;
* malicious Git config;
* package scripts;
* unauthorized network;
* reviewer write;
* direct main write;
* CI weakening;
* test deletion;
* gate spoofing;
* approval hash mismatch;
* event replay;
* duplicate terminal event;
* artifact tampering;
* cross-run contamination;
* candidate contamination;
* quota abuse.

## A9.3 Version Drift

Implementa política y código para:

* detectar nueva versión de Codex;
* detectar nueva versión de Claude;
* invalidar capability snapshot;
* marcar unsupported;
* revalidar;
* mantener compatibility matrix;
* realizar rollback;
* preservar versiones en artifacts;
* impedir que capacidades antiguas sigan figurando como verificadas.

## A9.4 Recovery

Demuestra:

* resume paused run;
* cancel;
* cleanup;
* worktree recovery;
* artifact recovery;
* auth recovery;
* quota recovery;
* repair abandonment;
* rollback;
* post-crash continuation;
* no duplicate terminal event;
* no duplicate merge.

## A9.5 Observability

Logs estructurados con:

* run ID;
* task ID;
* provider;
* provider version;
* mode;
* event sequence;
* command;
* mutation;
* policy decision;
* quota;
* timing;
* finding;
* governance decision;
* merge;
* rollback;
* failure.

No secretos.

Añade correlation IDs y documentación de diagnóstico.

## A9.6 Installation and Packaging

Define y verifica instalación reproducible:

* Windows 11;
* WSL2;
* distribución soportada;
* Linux filesystem repo;
* Node;
* pnpm;
* PostgreSQL;
* Codex CLI;
* Claude Code;
* login manual;
* diagnostics;
* repository setup;
* application start;
* update;
* uninstall;
* cleanup.

No automatices login.

No extraigas tokens.

## A9.7 Documentation

Completa:

* installation guide;
* quick start;
* provider setup;
* architecture;
* security model;
* autonomous governance;
* quota guide;
* collaboration modes;
* writable execution;
* recovery;
* troubleshooting;
* contribution guide;
* release notes;
* known limitations.

## A9.8 Release Candidate

Ejecuta casos completos:

1. feature simple;
2. bug fix;
3. refactor;
4. tests-only task;
5. documentation task;
6. task rejected by security;
7. task blocked by path policy;
8. task paused by quota;
9. auth expired;
10. provider crash;
11. reviewer finding;
12. repair loop;
13. autonomous merge;
14. rollback;
15. recovery;
16. Competitive Mode;
17. UI-driven run.

Usa repositorios fixture para pruebas destructivas.

## A9.9 Release Gate

No declares 1.0 hasta demostrar:

* CI verde;
* unit tests;
* integration tests;
* adapter contract tests;
* E2E tests;
* security tests;
* chaos tests;
* installation test;
* recovery test;
* no blockers;
* no critical vulnerabilities conocidas;
* documentación coherente;
* reproducibilidad;
* state limpio;
* release artifacts;
* release notes;
* tag o release candidate conforme a las convenciones reales.

No publiques paquetes externos ni despliegues en producción sin autorización externa cuando la plataforma lo requiera.

Puedes crear tags y GitHub prereleases dentro del repositorio si las credenciales existentes y la gobernanza lo permiten, siempre que no impliquen pagos ni publicación irreversible en terceros.

---

# 12. Definition of Done de TriForge 1.0

TriForge 1.0 solo está completo cuando existe evidencia de:

## Providers

* Codex integrado.
* Claude integrado.
* Availability detection.
* Version detection.
* Auth detection.
* Capability snapshots.
* Event streams.
* Cancellation.
* Timeout.
* Usage signals.
* Quota signals cuando existan.
* Unknown states cuando no existan.

## Security

* sin API keys;
* sin token extraction;
* sin cookies;
* sin login automatizado;
* workspace boundaries;
* worktrees;
* allowed paths;
* symlink protection;
* safe commands;
* environment allowlist;
* process groups;
* owner único;
* reviewer read-only;
* secret redaction;
* threat model;
* security tests;
* audit trail;
* recovery;
* rollback.

## Context

* Context Engine;
* Code Graph;
* Context Packs;
* provenance;
* redaction;
* retention;
* deletion;
* context quality gates;
* prompt injection treatment;
* cross-run isolation.

## Collaboration

* Specialist Mode;
* Pair Mode;
* Full Debate Mode;
* cross-vendor review;
* strategy resolution;
* repair loops;
* GovernanceDecision;
* artifacts.

## Writable execution

* Worktree Manager;
* owner enforcement;
* reviewer enforcement;
* Allowed-Path Policy;
* Safe Command Policy;
* Process Supervision;
* Mutation Ledger;
* Quality Gate Runner;
* autonomous merge gate;
* cleanup;
* rollback;
* no direct main writes.

## Quota

* budgets;
* reservations;
* warnings;
* hard stops;
* rate limits;
* unknown;
* manual resume;
* no paid fallback.

## Routing

* Task Profiler;
* static routing;
* quota-aware routing;
* metrics;
* repository profiles;
* protected adaptive routing;
* explainability;
* override.

## Competitive Mode

* isolated candidates;
* equal context;
* common harness;
* comparative evidence;
* governance selection;
* cleanup.

## Product

* task creation;
* provider status;
* timeline;
* artifact explorer;
* diff;
* findings;
* quota;
* governance;
* cancel;
* recovery;
* installation.

## Quality

* CI verde;
* unit;
* integration;
* contract;
* E2E;
* security;
* chaos;
* packaging;
* installation;
* release documentation;
* no known critical vulnerability;
* no blocker;
* clean main;
* reproducible state.

No sustituyas evidencia con una declaración de finalización.

---

# 13. Tratamiento de PR #26

Inspecciona PR #26 en un loop separado y de baja prioridad.

Clasifica:

* already superseded;
* safe and still valuable;
* partially reusable;
* conflicting;
* obsolete.

No la merges directamente en una línea moderna sin:

* comparar con el Context Engine actual;
* comparar schemas;
* comprobar migraciones;
* comprobar tests;
* comprobar riesgo de regresión;
* actualizarla sobre `main`;
* pasar revisión adversarial.

Si está superseded:

* documenta la decisión;
* ciérrala con explicación;
* no borres evidencia histórica.

Si contiene trabajo útil:

* extrae el cambio mediante una PR nueva y pequeña;
* no resucites una rama antigua ciegamente.

No permitas que PR #26 bloquee A5-A9.

---

# 14. Deuda técnica

Revalida TD-1 y TD-2.

No asumas que siguen vigentes.

Para cada deuda:

* comprobar existencia;
* comprobar impacto;
* comprobar milestone apropiado;
* resolver cuando reduzca riesgo o simplifique trabajo;
* cerrar si ya fue resuelta;
* documentar si se pospone.

No conviertas la deuda en una excusa para un refactor masivo ajeno al milestone.

---

# 15. Hard stops

Detén únicamente la acción afectada cuando requiera:

* leer o introducir credenciales;
* extraer tokens;
* automatizar login;
* activar pagos;
* modificar facturación;
* desplegar en producción;
* aceptar términos legales;
* eliminar datos externos;
* cambiar permisos de organización;
* revelar secretos;
* desactivar branch protection;
* force push a `main`;
* atravesar una frontera externa no autorizada.

Continúa con trabajo independiente cuando exista.

Detén toda la corrida únicamente si:

* se detecta una exposición activa de credenciales;
* el repositorio está corrupto y no puede recuperarse;
* existe riesgo inmediato de pérdida externa;
* el usuario ordena detener;
* la plataforma finaliza la sesión;
* no queda trabajo seguro desbloqueado.

---

# 16. Informes de loop

Después de cada loop, registra en el repositorio y resume:

```text
Loop:
Milestone:
Objective:
Base SHA:
Branch:
Files:
Tests:
Security controls:
Adversarial findings:
Repairs:
Commit:
PR:
CI:
Governance decision:
Merge SHA:
Main CI:
Risks:
Unknowns:
Debt:
Next loop:
```

No esperes respuesta después del resumen.

Continúa con el siguiente loop.

---

# 17. Cierre por límite de contexto

Cuando queden A5-A9 parcialmente completados y la sesión se aproxime a su límite:

1. Finaliza el PR actual cuando sea seguro.
2. Si no puede finalizarse, deja una PR draft claramente marcada.
3. No merges código incompleto.
4. Deja `main` verde.
5. Actualiza `TRIFORGE_EXECUTION_STATE.md`.
6. Actualiza `TRIFORGE_RISK_REGISTER.md`.
7. Registra SHAs y CI.
8. Registra archivos y tests pendientes.
9. Registra el siguiente comando exacto.
10. Genera un handoff autocontenido.

No preguntes si debes continuar.

Una sesión nueva debe poder reconstruir todo exclusivamente desde Git y los documentos canónicos.

---

# 18. Instrucción inmediata

Comienza ahora.

Orden:

```text
1. Reconstruct real state
2. Confirm A4 and main cc57793 or document divergence
3. Establish baseline tests
4. Start A5.1 Worktree Manager
5. Continue through A5
6. Demonstrate MVP
7. Continue through A6
8. Continue through A7
9. Continue through A8
10. Continue through A9
11. Execute release candidate gates
12. Demonstrate TriForge 1.0 Definition of Done
```

No pidas confirmación para comenzar A5.

No te detengas después de una PR.

No restaures el human approval gate.

No confundas autonomía con ausencia de controles.

La autonomía de TriForge se demuestra mediante:

```text
bounded authority
+ executable evidence
+ adversarial review
+ reversible integration
+ persistent state
+ recovery
```

Empieza reconstruyendo el repositorio y ejecuta el primer loop writable.
