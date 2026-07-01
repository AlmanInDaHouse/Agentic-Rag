/**
 * TriForge product shell (A11 redesign).
 *
 * Gates on the client-side demo session: no session → the login screen; session → the
 * full app shell (sidebar + topbar) with hash-routed pages. The integrated run pipeline
 * (create → start → live monitor) is unchanged underneath — this is a UX/UI redesign over
 * the same honest backend contracts.
 */

import React from "react";
import { useSession } from "./state/session.js";
import { useNavigation } from "./state/navigation.js";
import { useSystemHealth } from "./state/config.js";
import { LoginScreen } from "./auth/LoginScreen.js";
import { AppShell } from "./shell/AppShell.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { NewRunPage } from "./pages/NewRunPage.js";
import { MonitoringPage } from "./pages/MonitoringPage.js";
import { HistoryPage } from "./pages/HistoryPage.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

export function TriforgeApp(): JSX.Element {
  const { session, enter, leave } = useSession();
  const { route, navigate } = useNavigation();
  const systemStatus = useSystemHealth();

  if (!session.active) {
    return <LoginScreen onEnter={enter} />;
  }

  return (
    <AppShell view={route.view} systemStatus={systemStatus} onNavigate={navigate} onLeaveDemo={leave}>
      {route.view === "dashboard" ? <DashboardPage /> : null}
      {route.view === "new-run" ? <NewRunPage /> : null}
      {route.view === "monitoring" ? <MonitoringPage runId={route.runId} /> : null}
      {route.view === "history" ? <HistoryPage /> : null}
      {route.view === "agents" ? <AgentsPage /> : null}
      {route.view === "settings" ? <SettingsPage /> : null}
    </AppShell>
  );
}
