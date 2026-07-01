/**
 * Agentes (A11 redesign) — honest description of the two active providers (Codex/Claude)
 * plus an "Añadir Agente" catalog of well-known AI models.
 *
 * HONESTY: TriForge currently orchestrates only Codex + Claude. The catalog is a
 * reference surface — adding a new agent is NOT wired to any backend, the modal says so,
 * and "Añadir" is a clearly-labelled visual selection only. Clicking a model opens its
 * OFFICIAL subscription page in a new tab; hovering reveals indicative subscription + API
 * pricing. All prices are indicative (external, versioned) and flagged as such.
 */

import React, { useState } from "react";
import { Card, CardBody, CardHead, Badge, Alert, Button, Modal } from "../components/ui/index.js";
import { TextInput } from "../components/ui/Field.js";
import { IconAgents, IconAlert, IconShield, IconLayers, IconRocket, IconCheck, IconSearch, IconExternal } from "../components/brand/icons.js";
import {
  ProviderAvatar,
  OpenAILogo,
  AnthropicLogo,
  GeminiLogo,
  GrokLogo,
  MistralLogo,
  CopilotLogo,
  PerplexityLogo,
  QwenLogo,
  DeepSeekLogo
} from "../components/brand/providerLogos.js";
import { navigate } from "../state/navigation.js";

interface AgentInfo {
  id: "codex" | "claude";
  name: string;
  role: string;
  tone: "codex" | "claude";
  blurb: string;
  points: string[];
}

const AGENTS: AgentInfo[] = [
  {
    id: "codex",
    name: "Codex",
    role: "Propietario (owner)",
    tone: "codex",
    blurb: "Implementa los cambios dentro de un worktree aislado, respetando la política de rutas.",
    points: ["Escribe ficheros (sujeto a write paths)", "Ejecuta herramientas y gates", "Se ejecuta en modo mock o real"]
  },
  {
    id: "claude",
    name: "Claude",
    role: "Revisor (reviewer)",
    tone: "claude",
    blurb: "Revisa los cambios en solo lectura y emite un veredicto entre proveedores distintos.",
    points: ["Solo lectura (no escribe)", "Produce hallazgos por severidad", "Veredicto PASS / FAIL con motivo"]
  }
];

interface Plan {
  name: string;
  price: string;
}
interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  plan: string;
  price: string;
  period: string;
  desc: string;
  logo: React.ReactNode;
  /** Official subscription / pricing page (opens in a new tab). */
  url: string;
  subs: Plan[];
  api: Plan[];
}

/**
 * Reference catalog. Subscription prices ≈ €/mes con IVA; API prices ≈ USD por 1M tokens.
 * All INDICATIVE and subject to change.
 */
const CATALOG: ModelInfo[] = [
  {
    id: "chatgpt", name: "ChatGPT", vendor: "OpenAI", plan: "Plus", price: "23", period: "€/mes",
    desc: "GPT‑5 y razonadores o‑series para tareas generales y de código.",
    logo: <span style={{ color: "var(--tf-text)" }}><OpenAILogo size={24} /></span>,
    url: "https://openai.com/chatgpt/pricing/",
    subs: [{ name: "Free", price: "0 €" }, { name: "Plus", price: "23 €/mes" }, { name: "Pro", price: "229 €/mes" }],
    api: [{ name: "GPT‑5 entrada", price: "$1,25/1M" }, { name: "GPT‑5 salida", price: "$10/1M" }, { name: "GPT‑5 mini", price: "$0,25/1M" }]
  },
  {
    id: "claude", name: "Claude", vendor: "Anthropic", plan: "Pro", price: "19", period: "€/mes",
    desc: "Claude Opus/Sonnet, fuerte en código, análisis y contexto largo.",
    logo: <AnthropicLogo size={24} />,
    url: "https://www.anthropic.com/pricing",
    subs: [{ name: "Free", price: "0 €" }, { name: "Pro", price: "19 €/mes" }, { name: "Max", price: "desde 100 €/mes" }],
    api: [{ name: "Sonnet in/out", price: "$3 / $15" }, { name: "Opus in/out", price: "$15 / $75" }, { name: "Haiku in/out", price: "$0,80 / $4" }]
  },
  {
    id: "gemini", name: "Gemini", vendor: "Google", plan: "AI Pro", price: "21,99", period: "€/mes",
    desc: "Gemini 2.x multimodal, integrado con el ecosistema Google.",
    logo: <GeminiLogo size={24} idSuffix="cat" />,
    url: "https://gemini.google/subscriptions/",
    subs: [{ name: "Free", price: "0 €" }, { name: "AI Pro", price: "21,99 €/mes" }, { name: "AI Ultra", price: "274,99 €/mes" }],
    api: [{ name: "2.5 Flash in/out", price: "$0,30 / $2,50" }, { name: "2.5 Pro in/out", price: "$1,25 / $10" }]
  },
  {
    id: "grok", name: "Grok", vendor: "xAI", plan: "SuperGrok", price: "30", period: "€/mes",
    desc: "Grok con acceso en tiempo real y modo razonamiento.",
    logo: <span style={{ color: "var(--tf-text)" }}><GrokLogo size={22} /></span>,
    url: "https://x.ai/grok",
    subs: [{ name: "Basic", price: "0 €" }, { name: "SuperGrok", price: "30 €/mes" }, { name: "Heavy", price: "300 €/mes" }],
    api: [{ name: "grok‑4 in/out", price: "$3 / $15" }, { name: "grok‑4 fast", price: "$0,20 / $0,50" }]
  },
  {
    id: "copilot", name: "Copilot", vendor: "Microsoft", plan: "Pro", price: "22", period: "€/mes",
    desc: "Asistente de Microsoft; Copilot Pro para individuos y M365.",
    logo: <CopilotLogo size={26} idSuffix="cat" />,
    url: "https://www.microsoft.com/microsoft-copilot",
    subs: [{ name: "Free", price: "0 €" }, { name: "Pro", price: "22 €/mes" }, { name: "M365 Copilot", price: "desde 30 €/usuario" }],
    api: [{ name: "API por tokens", price: "—" }, { name: "Modelo", price: "vía suscripción" }]
  },
  {
    id: "perplexity", name: "Perplexity", vendor: "Perplexity", plan: "Pro", price: "20", period: "€/mes",
    desc: "Búsqueda con respuestas citadas y varios modelos a elegir.",
    logo: <PerplexityLogo size={24} />,
    url: "https://www.perplexity.ai/pro",
    subs: [{ name: "Free", price: "0 €" }, { name: "Pro", price: "20 €/mes" }, { name: "Max", price: "40 €/mes" }],
    api: [{ name: "Sonar in/out", price: "$1 / $1" }, { name: "Sonar Pro", price: "$3 / $15" }, { name: "Búsqueda", price: "$5 /1k" }]
  },
  {
    id: "mistral", name: "Le Chat", vendor: "Mistral AI", plan: "Pro", price: "14,99", period: "€/mes",
    desc: "Modelos abiertos europeos, rápidos y eficientes.",
    logo: <MistralLogo size={24} />,
    url: "https://mistral.ai/products/le-chat",
    subs: [{ name: "Free", price: "0 €" }, { name: "Pro", price: "14,99 €/mes" }, { name: "Team", price: "desde 24,99 €" }],
    api: [{ name: "Medium in/out", price: "$0,40 / $2" }, { name: "Large in/out", price: "$2 / $6" }]
  },
  {
    id: "deepseek", name: "DeepSeek", vendor: "DeepSeek", plan: "API", price: "Según uso", period: "pago por tokens",
    desc: "Modelos de razonamiento muy competitivos en coste vía API.",
    logo: <DeepSeekLogo size={26} />,
    url: "https://platform.deepseek.com/",
    subs: [{ name: "Chat web", price: "gratis" }, { name: "Plataforma", price: "pago por uso" }],
    api: [{ name: "chat in/out", price: "$0,27 / $1,10" }, { name: "reasoner in/out", price: "$0,55 / $2,19" }]
  },
  {
    id: "qwen", name: "Qwen", vendor: "Alibaba", plan: "Chat / API", price: "Gratis", period: "chat · API por uso",
    desc: "Tongyi Qwen: familia abierta y modelos max/plus vía Model Studio.",
    logo: <QwenLogo size={24} idSuffix="cat" />,
    url: "https://chat.qwen.ai/",
    subs: [{ name: "Qwen Chat", price: "gratis" }, { name: "Model Studio", price: "pago por uso" }],
    api: [{ name: "qwen‑max in/out", price: "$1,60 / $6,40" }, { name: "qwen‑plus in/out", price: "$0,40 / $1,20" }]
  }
];

function openOfficial(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function AgentsPage(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = CATALOG.filter(
    (m) => `${m.name} ${m.vendor}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="tf-page-head">
        <div>
          <h2>Agentes</h2>
          <p>Los dos proveedores de IA que colaboran en cada ejecución. Sus roles son intercambiables por ejecución.</p>
        </div>
        <div className="tf-row">
          <Button variant="primary" size="sm" icon={<IconAgents size={15} />} onClick={() => setOpen(true)}>
            Añadir Agente
          </Button>
          <Button variant="subtle" size="sm" icon={<IconRocket size={15} />} onClick={() => navigate("new-run")}>
            Nueva ejecución
          </Button>
        </div>
      </div>

      <div className="tf-grid tf-grid--2">
        {AGENTS.map((a) => (
          <Card key={a.id} accent={a.tone === "codex" ? "amber" : "purple"}>
            <div className={`tf-agent__head tf-agent--${a.tone}`}>
              <ProviderAvatar provider={a.id} size={44} />
              <div className="tf-agent__meta">
                <div className="tf-agent__name">{a.name}</div>
                <div className="tf-agent__role">{a.role}</div>
              </div>
              <Badge tone={a.tone}>por defecto</Badge>
            </div>
            <CardBody>
              <p className="tf-secondary" style={{ fontSize: "0.9rem" }}>{a.blurb}</p>
              <ul style={{ margin: "var(--tf-space-4) 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
                {a.points.map((p) => (
                  <li key={p} className="tf-row" style={{ gap: 10, fontSize: "0.86rem" }}>
                    <span className="tf-dot tf-dot--neutral" /> <span className="tf-secondary">{p}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card style={{ marginTop: "var(--tf-space-6)" }}>
        <CardHead title="Modos de colaboración" icon={<IconLayers size={18} />} />
        <CardBody>
          <div className="tf-grid tf-grid--2">
            <div className="tf-file" style={{ padding: 14, alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
              <Badge tone="info">Especialista</Badge>
              <span className="tf-secondary" style={{ fontSize: "0.86rem", fontFamily: "var(--tf-font-sans)" }}>
                El owner implementa y el reviewer revisa. Roles fijos durante la ejecución.
              </span>
            </div>
            <div className="tf-file" style={{ padding: 14, alignItems: "flex-start", flexDirection: "column", gap: 6 }}>
              <Badge tone="info">En pareja</Badge>
              <span className="tf-secondary" style={{ fontSize: "0.86rem", fontFamily: "var(--tf-font-sans)" }}>
                Colaboración más acoplada entre ambos proveedores sobre la misma tarea.
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      <Alert tone="info" icon={<IconShield size={18} />} style={{ marginTop: "var(--tf-space-5)" }}>
        <strong>Estado en tiempo real:</strong> esta vista no consulta un endpoint de estado del proveedor. La
        instalación, autenticación y versión reales de cada CLI se comprueban al ejecutar en modo <span className="tf-mono">real</span> y
        se muestran como <em>provenance</em> en la monitorización de cada ejecución.
      </Alert>

      <Alert tone="warning" icon={<IconAlert size={18} />} style={{ marginTop: "var(--tf-space-3)" }}>
        En modo <span className="tf-mono">real</span> no hay <em>fallback</em> silencioso a mock: si el owner no es capaz de escribir o no está
        autenticado, la ejecución termina <span className="tf-mono">bloqueada</span>, nunca simulada.
      </Alert>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Añadir Agente"
        icon={<IconAgents size={18} />}
        width={1060}
        footer={
          <>
            <span className="tf-muted" style={{ fontSize: "0.78rem" }}>
              {selected.size > 0 ? `${selected.size} modelo(s) seleccionados (demo)` : "Clic en un modelo para ver sus planes oficiales · precios orientativos"}
            </span>
            <Button variant="primary" size="sm" onClick={() => setOpen(false)}>Hecho</Button>
          </>
        }
      >
        <Alert tone="info" icon={<IconAlert size={16} />} style={{ marginBottom: "var(--tf-space-4)" }}>
          Catálogo de referencia. TriForge orquesta hoy <strong>Codex</strong> y <strong>Claude</strong>; la incorporación real de
          nuevos agentes aún no está disponible. Haz clic en un modelo para abrir su página oficial; pasa el ratón para ver sus
          planes. Los precios son <strong>orientativos</strong> y pueden cambiar.
        </Alert>

        <div style={{ marginBottom: "var(--tf-space-4)", maxWidth: 320 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--tf-text-muted)" }}>
              <IconSearch size={16} />
            </span>
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar modelo o proveedor…"
              style={{ paddingLeft: 34 }}
              aria-label="Buscar modelo"
            />
          </div>
        </div>

        <div className="tf-models">
          {filtered.map((m) => {
            const isSel = selected.has(m.id);
            return (
              <div
                key={m.id}
                className="tf-model tf-model--link"
                data-selected={isSel}
                role="link"
                tabIndex={0}
                title={`Abrir los planes oficiales de ${m.name}`}
                onClick={() => openOfficial(m.url)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openOfficial(m.url);
                  }
                }}
              >
                <div className="tf-model__head">
                  <span className="tf-model__logo">{m.logo}</span>
                  <div className="tf-grow">
                    <div className="tf-model__name">{m.name}</div>
                    <div className="tf-model__vendor">{m.vendor} · {m.plan}</div>
                  </div>
                  <span className="tf-model__ext" aria-hidden><IconExternal size={15} /></span>
                </div>
                <p className="tf-model__desc">{m.desc}</p>
                <div className="tf-model__price">
                  <b>{m.price}</b>
                  <span>{m.period}</span>
                </div>
                <Button
                  variant={isSel ? "subtle" : "default"}
                  size="sm"
                  block
                  icon={isSel ? <IconCheck size={15} /> : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(m.id);
                  }}
                >
                  {isSel ? "Añadido (demo)" : "Añadir"}
                </Button>

                {/* hover: subscription + API plans */}
                <div className="tf-model__pop" role="tooltip">
                  <div className="tf-pop__sec">
                    <div className="tf-pop__h"><span>Suscripción</span></div>
                    {m.subs.map((p) => (
                      <div key={p.name} className="tf-pop__row"><span>{p.name}</span><b>{p.price}</b></div>
                    ))}
                  </div>
                  <div className="tf-pop__sec">
                    <div className="tf-pop__h"><span>API</span><span>por 1M tokens</span></div>
                    {m.api.map((p) => (
                      <div key={p.name} className="tf-pop__row"><span>{p.name}</span><b>{p.price}</b></div>
                    ))}
                  </div>
                  <div className="tf-pop__foot">Precios orientativos · clic para ver los oficiales ↗</div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 ? <p className="tf-muted">Sin resultados para “{query}”.</p> : null}
        </div>
      </Modal>
    </>
  );
}
