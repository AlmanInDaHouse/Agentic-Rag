/**
 * Nueva ejecución (A11 redesign) — the premium task-launch form. Same honest backend
 * contract as the old console (create → start → monitor), restyled into labelled blocks
 * with Spanish microcopy and inline validation. The documented browser E2E selectors are
 * preserved as `data-testid`s. On launch it creates + starts the run, records it in the
 * local registry, and routes to the live monitoring view.
 */

import React, { useMemo, useState } from "react";
import { Card, CardBody, CardHead, Button, Alert, Badge } from "../components/ui/index.js";
import { Field, TextInput, TextArea, Select } from "../components/ui/Field.js";
import { IconRocket, IconTool, IconShield, IconAlert, IconLayers } from "../components/brand/icons.js";
import { createIntegratedRun, startIntegratedRun, type CreateIntegratedRunInput } from "../integratedApi.js";
import { upsertRun } from "../state/runsStore.js";
import { navigate } from "../state/navigation.js";

const PROVIDERS = ["codex", "claude"] as const;

export function NewRunPage(): JSX.Element {
  const [objective, setObjective] = useState("Añade un helper slugify en src/ con su test pasando");
  const [owner, setOwner] = useState("codex");
  const [reviewer, setReviewer] = useState("claude");
  const [collaborationMode, setCollaborationMode] = useState<"specialist" | "pair">("specialist");
  const [providerMode, setProviderMode] = useState<"mock" | "real">("mock");
  const [fixtureRepoPath, setFixtureRepoPath] = useState("");
  const [writePaths, setWritePaths] = useState("src");
  const [readPaths, setReadPaths] = useState(".");
  const [maxRepairRounds, setMaxRepairRounds] = useState(2);
  const [maxFilesChanged, setMaxFilesChanged] = useState(10);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (objective.trim().length < 3) e.objective = "Describe el objetivo (mínimo 3 caracteres).";
    if (!fixtureRepoPath.trim()) e.fixture = "Indica una ruta absoluta a un repo git desechable fuera de TriForge.";
    else if (!/^([a-zA-Z]:\\|\/)/.test(fixtureRepoPath.trim())) e.fixture = "Debe ser una ruta absoluta (p. ej. C:\\tmp\\fixture).";
    if (writePaths.split(",").map((s) => s.trim()).filter(Boolean).length === 0) e.write = "Indica al menos una ruta de escritura.";
    return e;
  }, [objective, fixtureRepoPath, writePaths]);

  const valid = Object.keys(errors).length === 0;

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const input: CreateIntegratedRunInput = {
        objective: objective.trim(),
        owner,
        reviewer,
        providerMode,
        collaborationMode,
        fixtureRepoPath: fixtureRepoPath.trim(),
        writePaths: writePaths.split(",").map((s) => s.trim()).filter(Boolean),
        readPaths: readPaths.split(",").map((s) => s.trim()).filter(Boolean),
        maxFilesChanged,
        gates: [{ name: "unit", command: { bin: "npm", args: ["test"] } }],
        budget: { maxRepairRounds, perRunTimeoutMs: 240_000 }
      };
      const created = await createIntegratedRun(input);
      upsertRun({
        id: created.id,
        status: created.status,
        objective: input.objective,
        owner,
        reviewer,
        providerMode,
        collaborationMode
      });
      await startIntegratedRun(created.id);
      navigate("monitoring", created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tf-page-head">
        <div>
          <h2>Nueva ejecución</h2>
          <p>Define la tarea, elige los proveedores y los límites, y lánzala sobre un repositorio desechable aislado.</p>
        </div>
      </div>

      {error ? (
        <Alert tone="danger" icon={<IconAlert size={18} />} className="tf-mono" data-testid="error" role="alert" style={{ marginBottom: "var(--tf-space-5)" }}>
          {error}
        </Alert>
      ) : null}

      <form className="tf-runform" onSubmit={onSubmit}>
        <Card accent="cyan">
          <CardHead title="Objetivo de la tarea" icon={<IconRocket size={18} />} />
          <CardBody>
            <div className="tf-fieldset">
              <Field label="¿Qué debe conseguir la ejecución?" hint="Instrucción clara para el agente propietario." error={errors.objective}>
                <TextArea
                  data-testid="objective-input"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  rows={3}
                  aria-invalid={Boolean(errors.objective)}
                  placeholder="Ej. Añade validación de entrada al endpoint /login con su test"
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <div className="tf-grid tf-grid--2">
          <Card accent="amber">
            <CardHead title="Agentes y colaboración" icon={<IconLayers size={18} />} />
            <CardBody>
              <div className="tf-fieldset">
                <div className="tf-form-grid">
                  <Field label="Propietario (owner)" hint="Implementa los cambios.">
                    <Select data-testid="owner-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
                      {PROVIDERS.map((p) => (
                        <option key={p} value={p}>{p === "codex" ? "Codex" : "Claude"}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Revisor (reviewer)" hint="Revisa en solo lectura.">
                    <Select data-testid="reviewer-select" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                      {PROVIDERS.map((p) => (
                        <option key={p} value={p}>{p === "codex" ? "Codex" : "Claude"}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Modo de colaboración" hint="Especialista o en pareja.">
                    <Select
                      data-testid="mode-select"
                      value={collaborationMode}
                      onChange={(e) => setCollaborationMode(e.target.value as "specialist" | "pair")}
                    >
                      <option value="specialist">Especialista</option>
                      <option value="pair">En pareja</option>
                    </Select>
                  </Field>
                  <Field
                    label={
                      <>
                        Modo de proveedor{" "}
                        <Badge tone={providerMode === "real" ? "success" : "info"}>{providerMode === "real" ? "real" : "mock"}</Badge>
                      </>
                    }
                    hint={providerMode === "real" ? "Ejecución real (requiere CLIs autenticadas)." : "Simulación honesta, sin CLI real."}
                  >
                    <Select
                      data-testid="provider-mode-select"
                      value={providerMode}
                      onChange={(e) => setProviderMode(e.target.value as "mock" | "real")}
                    >
                      <option value="mock">mock — simulado</option>
                      <option value="real">real — proveedores reales</option>
                    </Select>
                  </Field>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card accent="purple">
            <CardHead title="Repositorio y límites" icon={<IconShield size={18} />} />
            <CardBody>
              <div className="tf-fieldset">
                <Field
                  label="Repositorio fixture (ruta absoluta)"
                  hint="Repo git desechable FUERA de TriForge. El backend lo valida."
                  error={errors.fixture}
                >
                  <TextInput
                    data-testid="fixture-input"
                    mono
                    value={fixtureRepoPath}
                    onChange={(e) => setFixtureRepoPath(e.target.value)}
                    placeholder="C:\\tmp\\triforge-fixture"
                    aria-invalid={Boolean(errors.fixture)}
                  />
                </Field>
                <div className="tf-form-grid">
                  <Field label="Rutas de escritura" hint="Separadas por comas." error={errors.write}>
                    <TextInput data-testid="writepaths-input" mono value={writePaths} onChange={(e) => setWritePaths(e.target.value)} aria-invalid={Boolean(errors.write)} />
                  </Field>
                  <Field label="Máx. rondas de reparación" hint="0–5.">
                    <TextInput
                      data-testid="repair-input"
                      type="number"
                      min={0}
                      max={5}
                      value={maxRepairRounds}
                      onChange={(e) => setMaxRepairRounds(Number(e.target.value))}
                    />
                  </Field>
                </div>
                <button type="button" className="tf-btn tf-btn--ghost tf-btn--sm" style={{ justifySelf: "start" }} onClick={() => setAdvanced((a) => !a)}>
                  <IconTool size={15} /> {advanced ? "Ocultar avanzado" : "Opciones avanzadas"}
                </button>
                {advanced ? (
                  <div className="tf-form-grid">
                    <Field label="Rutas de lectura" hint="Separadas por comas.">
                      <TextInput mono value={readPaths} onChange={(e) => setReadPaths(e.target.value)} />
                    </Field>
                    <Field label="Máx. ficheros modificados" hint="1–200.">
                      <TextInput type="number" min={1} max={200} value={maxFilesChanged} onChange={(e) => setMaxFilesChanged(Number(e.target.value))} />
                    </Field>
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardBody>
            <div className="tf-runform__footer">
              <div className="tf-muted" style={{ fontSize: "0.82rem", maxWidth: "52ch" }}>
                Al iniciar, TriForge crea un worktree aislado, aplica la política de rutas y ejecuta el
                pipeline gobernado (implementación → gates → revisión → gobernanza → merge).
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                data-testid="start-btn"
                disabled={busy || !valid}
                icon={<IconRocket size={18} />}
              >
                {busy ? "Iniciando…" : "Crear e iniciar ejecución"}
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </>
  );
}
