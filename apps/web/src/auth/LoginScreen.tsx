/**
 * Login screen (A11 redesign).
 *
 * HONEST BY DESIGN: TriForge has no real authentication. The Google/GitHub buttons are
 * visual only (disabled, "próximamente") and never sign anyone in. The single working
 * path is "Entrar al entorno demo", which flips the client-side demo session. The copy
 * says exactly this so the UI never implies auth that doesn't exist.
 */

import React from "react";
import { TriquetraLogo } from "../components/brand/TriquetraLogo.js";
import { Button } from "../components/ui/index.js";
import { IconRocket } from "../components/brand/icons.js";

function GoogleGlyph(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function GithubGlyph(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M12 1.5A10.5 10.5 0 0 0 1.5 12c0 4.64 3 8.57 7.18 9.96.53.1.72-.23.72-.5v-1.76c-2.92.64-3.54-1.25-3.54-1.25-.48-1.21-1.17-1.53-1.17-1.53-.95-.65.07-.64.07-.64 1.06.07 1.61 1.09 1.61 1.09.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.16-4.78-5.18 0-1.14.41-2.08 1.08-2.81-.11-.27-.47-1.34.1-2.8 0 0 .88-.28 2.88 1.07a10 10 0 0 1 5.24 0c2-1.35 2.88-1.07 2.88-1.07.57 1.46.21 2.53.1 2.8.67.73 1.08 1.67 1.08 2.81 0 4.03-2.46 4.91-4.8 5.17.38.33.71.97.71 1.96v2.9c0 .28.19.61.72.5A10.5 10.5 0 0 0 22.5 12 10.5 10.5 0 0 0 12 1.5z" />
    </svg>
  );
}

export function LoginScreen({ onEnter }: { onEnter: () => void }): JSX.Element {
  return (
    <div className="tf-login">
      <div className="tf-login__orb tf-login__orb--a" />
      <div className="tf-login__orb tf-login__orb--b" />
      <div className="tf-login__orb tf-login__orb--c" />

      <div className="tf-login__card">
        <div className="tf-login__logo">
          <TriquetraLogo size={72} glow idSuffix="login" />
        </div>
        <h1 className="tf-login__title">TriForge</h1>
        <p className="tf-login__subtitle">
          Orquestación local multi-agente — Codex &amp; Claude colaborando sobre tu código,
          con gobernanza y trazabilidad.
        </p>

        <div className="tf-login__actions">
          <button type="button" className="tf-social" disabled aria-disabled title="Autenticación social próximamente">
            <GoogleGlyph />
            Continuar con Google
            <span className="tf-social__soon">Próximamente</span>
          </button>
          <button type="button" className="tf-social" disabled aria-disabled title="Autenticación social próximamente">
            <GithubGlyph />
            Continuar con GitHub
            <span className="tf-social__soon">Próximamente</span>
          </button>

          <div className="tf-login__divider">Acceso rápido</div>

          <Button variant="primary" size="lg" block icon={<IconRocket size={18} />} onClick={onEnter} data-testid="enter-demo">
            Entrar al entorno
          </Button>
        </div>

        <p className="tf-login__foot">
          El acceso demo no requiere usuario ni contraseña y no autentica a un usuario real.
          La autenticación social aún no está implementada.
        </p>
      </div>
    </div>
  );
}
