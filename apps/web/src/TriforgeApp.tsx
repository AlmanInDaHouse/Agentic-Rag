/**
 * TriForge product UI (A10-W.8b). The integrated run console is the product surface:
 * submit a governed writable task to a real (or mock) provider and watch it execute
 * end-to-end. The legacy RAG dashboard (`App.tsx`) is retained in the codebase but is
 * no longer the default mount.
 */

import React from "react";
import { IntegratedRunConsole } from "./components/IntegratedRunConsole.js";

export function TriforgeApp(): JSX.Element {
  return (
    <main className="triforge-app">
      <header className="app-header">
        <h1>TriForge</h1>
        <p className="tagline">Local multi-agent CLI orchestration — Codex &amp; Claude, native Windows.</p>
      </header>
      <IntegratedRunConsole />
    </main>
  );
}
