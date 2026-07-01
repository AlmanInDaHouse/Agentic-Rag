/**
 * Render smoke test (A11 redesign). The web suite runs in a `node` env with no DOM, so we
 * server-render each top-level surface with `react-dom/server` (via React.createElement —
 * no JSX transform needed) to catch gross runtime errors: bad hook order, undefined refs,
 * throwing module init. It does not assert layout/pixels (that's tsc + vite build) — only
 * that every page mounts without throwing and emits its key Spanish copy.
 */

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { LoginScreen } from "./auth/LoginScreen.js";
import { AppShell } from "./shell/AppShell.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { NewRunPage } from "./pages/NewRunPage.js";
import { MonitoringPage } from "./pages/MonitoringPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { Badge } from "./components/ui/index.js";
import { RunOutcome } from "./components/run/RunOutcome.js";
import type { IntegratedRunView } from "./lib/integratedRun.js";

describe("render smoke — every surface mounts without throwing", () => {
  it("renders the login screen with the demo access", () => {
    const html = renderToString(createElement(LoginScreen, { onEnter: () => {} }));
    expect(html).toContain("TriForge");
    expect(html).toContain("Entrar al entorno");
    expect(html).toContain("Próximamente");
  });

  it("renders the app shell around a page", () => {
    const html = renderToString(
      createElement(AppShell, {
        view: "dashboard",
        systemStatus: "checking",
        onNavigate: () => {},
        onLeaveDemo: () => {},
        children: createElement(DashboardPage)
      })
    );
    expect(html).toContain("Dashboard");
    expect(html).toContain("Acciones rápidas");
  });

  it("renders the new-run form", () => {
    const html = renderToString(createElement(NewRunPage));
    expect(html).toContain("Nueva ejecución");
    expect(html).toContain("objective-input");
    expect(html).toContain("start-btn");
  });

  it("renders monitoring with no run selected", () => {
    const html = renderToString(createElement(MonitoringPage, { runId: null }));
    expect(html).toContain("No hay ninguna ejecución seleccionada");
  });

  it("renders history, agents and settings", () => {
    expect(renderToString(createElement(HistoryPage))).toContain("Historial");
    expect(renderToString(createElement(AgentsPage))).toContain("Agentes");
    expect(renderToString(createElement(SettingsPage))).toContain("Configuración");
  });

  // Regression guard: Badge must forward passthrough props (data-testid/aria/…) to the
  // DOM. The run-status/run-mode/collaboration-mode E2E selectors depend on this.
  it("Badge forwards data-testid to the DOM", () => {
    const html = renderToString(createElement(Badge, { tone: "success", "data-testid": "run-status" } as never, "En curso"));
    expect(html).toContain('data-testid="run-status"');
  });

  // Regression guard: the run-outcome E2E selectors must always be present, even when the
  // run has no captured diff (failed/blocked runs) — never hidden behind data presence.
  it("RunOutcome keeps its E2E selectors present when there is no diff", () => {
    const view: IntegratedRunView = {
      id: "r1",
      statusLabel: "failed",
      isTerminal: true,
      mode: "mock",
      collaborationMode: "specialist",
      owner: { label: "codex — mock", isReal: false, version: "mock" },
      reviewer: { label: "claude — mock", isReal: false, version: "mock" },
      events: [],
      sequenceGap: false,
      terminalCount: 1,
      governanceVerdict: "unknown",
      merged: "unknown",
      changedFiles: [],
      diff: { present: false, lineCount: "unknown", truncated: false },
      cleanup: "unknown",
      terminalReason: null
    };
    const html = renderToString(createElement(RunOutcome, { view, diffText: null }));
    for (const id of ["governance-verdict", "merged", "cleanup", "changed-files", "diff"]) {
      expect(html).toContain(`data-testid="${id}"`);
    }
  });
});
