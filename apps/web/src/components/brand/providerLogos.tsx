/**
 * Provider brand marks (A11) — inline SVG *recreations* of well-known AI product logos,
 * used to identify agents/models in the UI. Each inherits `currentColor` (except the
 * Anthropic sunburst, whose terracotta identity is intrinsic) and needs no binary asset.
 * These are approximations for identification, not official brand files.
 */

import React from "react";

export interface LogoProps {
  size?: number;
  className?: string;
  title?: string;
}

/** OpenAI / ChatGPT — the interlocking "blossom" knot (monochrome, currentColor). */
export function OpenAILogo({ size = 22, className, title = "OpenAI" }: LogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} role="img" aria-label={title}>
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.0201 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4926 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z" />
    </svg>
  );
}

/** Anthropic / Claude — the radial sunburst mark (terracotta blades). */
export function AnthropicLogo({ size = 22, className, title = "Anthropic" }: LogoProps): JSX.Element {
  const blades = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="#c96442" className={className} role="img" aria-label={title}>
      <g>
        {blades.map((deg) => (
          <path key={deg} d="M32 5 L34.6 15 L33.2 30 L30.8 30 L29.4 15 Z" transform={`rotate(${deg} 32 32)`} />
        ))}
      </g>
    </svg>
  );
}

/** Google Gemini — a four-point sparkle (its own gradient). */
export function GeminiLogo({ size = 22, className, title = "Gemini", idSuffix = "g" }: LogoProps & { idSuffix?: string }): JSX.Element {
  const id = `tf-gemini-${idSuffix}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id={id} x1="2" y1="12" x2="22" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285f4" />
          <stop offset="0.5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M12 2c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z" />
    </svg>
  );
}

/** xAI / Grok — a stylised slash-X. */
export function GrokLogo({ size = 22, className, title = "Grok" }: LogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} role="img" aria-label={title}>
      <path d="M6 3h3.4l9.1 12.6V21h-3.1l-3.6-5.1L6 21H2.6l6-8.3L2.9 3H6l4.2 5.9L14.4 3H18z" opacity="0.15" />
      <path d="M4 3h3.3l12.4 17.3-.02.0H16.4L4 3.7zM15.6 3H20l-6.1 8.5-1.9-2.6zM4.4 21l5.9-8.2 1.9 2.6L8.3 21z" />
    </svg>
  );
}

/** Mistral — stacked bars monogram. */
export function MistralLogo({ size = 22, className, title = "Mistral" }: LogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role="img" aria-label={title}>
      <g fill="#f2a73b">
        <rect x="3" y="4" width="4" height="4" />
        <rect x="17" y="4" width="4" height="4" />
      </g>
      <g fill="#f27a1a">
        <rect x="3" y="8" width="18" height="4" />
      </g>
      <g fill="#ea4c2b">
        <rect x="3" y="12" width="4" height="4" />
        <rect x="10" y="12" width="4" height="4" />
        <rect x="17" y="12" width="4" height="4" />
      </g>
      <g fill="#c62828">
        <rect x="3" y="16" width="18" height="4" />
      </g>
    </svg>
  );
}

/** Microsoft Copilot — colourful interlocking ribbon loops (recreation). */
export function CopilotLogo({ size = 22, className, title = "Copilot", idSuffix = "c" }: LogoProps & { idSuffix?: string }): JSX.Element {
  const a = `tf-cop-a-${idSuffix}`;
  const b = `tf-cop-b-${idSuffix}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id={a} x1="6" y1="8" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2aa5f0" />
          <stop offset="0.45" stopColor="#38b45a" />
          <stop offset="0.75" stopColor="#e7c93c" />
          <stop offset="1" stopColor="#f0913a" />
        </linearGradient>
        <linearGradient id={b} x1="42" y1="14" x2="16" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1f6fe5" />
          <stop offset="0.45" stopColor="#9a44d6" />
          <stop offset="0.8" stopColor="#ec4b8c" />
          <stop offset="1" stopColor="#fb8a3c" />
        </linearGradient>
      </defs>
      <g fill="none" strokeWidth="7" strokeLinejoin="round">
        <rect x="6" y="6" width="23" height="23" rx="9.5" stroke={`url(#${a})`} transform="rotate(-6 17.5 17.5)" />
        <rect x="19" y="19" width="23" height="23" rx="9.5" stroke={`url(#${b})`} transform="rotate(-6 30.5 30.5)" />
      </g>
    </svg>
  );
}

/** Perplexity — teal geometric burst inside a frame (recreation). */
export function PerplexityLogo({ size = 22, className, title = "Perplexity" }: LogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="#20b8cd" strokeWidth="3.2" strokeLinejoin="round" className={className} role="img" aria-label={title}>
      <rect x="10.5" y="14" width="27" height="20" />
      <line x1="24" y1="4" x2="24" y2="44" />
      <path d="M24 24 L11 11 M24 24 L37 11 M24 24 L11 37 M24 24 L37 37" />
      <path d="M24 14 L14 5 L14 14 Z M24 14 L34 5 L34 14 Z" fill="#20b8cd" stroke="none" />
    </svg>
  );
}

/** Qwen — purple interlocking hexagram (recreation). */
export function QwenLogo({ size = 22, className, title = "Qwen", idSuffix = "q" }: LogoProps & { idSuffix?: string }): JSX.Element {
  const id = `tf-qwen-${idSuffix}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id={id} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4b34c9" />
          <stop offset="1" stopColor="#7c5cf0" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${id})`} strokeWidth="4" strokeLinejoin="round" fill="none">
        <path d="M24 5 L41 34.5 L7 34.5 Z" />
        <path d="M24 43 L7 13.5 L41 13.5 Z" />
      </g>
      <path d="M24 20 L31.5 32 L16.5 32 Z" fill={`url(#${id})`} opacity="0.6" />
    </svg>
  );
}

/** DeepSeek — stylised blue whale (recreation). */
export function DeepSeekLogo({ size = 22, className, title = "DeepSeek" }: LogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="#4d6bfe" className={className} role="img" aria-label={title}>
      {/* body + upturned tail fluke */}
      <path d="M20 12C11.2 12 4 18.7 4 27s6.6 14 15.5 14c6.1 0 11.3-2.9 14.2-7.2 1.1 3 3.3 5.6 6 6.8.8.4 1.6-.5 1.1-1.2-1.3-2-1.9-3.9-1.7-6 1.9 1 4.2 1.2 6.3.4.8-.3.8-1.4 0-1.7-2.2-.8-3.8-2.3-4.7-4.4-.2-6-4.9-11.9-11.9-13.5-2.8-.6-4.9-1.4-4.6-2.3.2-.6-.4-1.1-1-.8-.9.5-1.4 1.4-1.4 2.4 0 .3 0 .5.1.8-.5 0-1-.1-1.7-.1z" />
      {/* white belly scoop + eye */}
      <path fill="#fff" d="M7.2 25.4c-.7-.4-1.5.3-1.2 1C8 32.6 13.3 36 19.6 36c1.3 0 1.6-1.8.4-2.3-5.3-2.2-9.3-4.9-12.8-8.3z" />
      <circle fill="#fff" cx="26.5" cy="22.5" r="1.6" />
    </svg>
  );
}

/** Generic monogram fallback for a model without a bespoke mark. */
export function MonogramLogo({ text, size = 22, className }: { text: string; size?: number; className?: string }): JSX.Element {
  return (
    <span
      className={className}
      style={{ fontFamily: "var(--tf-font-display)", fontWeight: 800, fontSize: size * 0.55, lineHeight: 1 }}
    >
      {text.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Resolve the mark for a TriForge provider id (codex → OpenAI, claude → Anthropic). */
export function ProviderMark({ provider, size = 22 }: { provider: string; size?: number }): JSX.Element {
  if (provider === "codex") return <OpenAILogo size={size} />;
  if (provider === "claude") return <AnthropicLogo size={size} />;
  return <MonogramLogo text={provider} size={size} />;
}

/**
 * Rounded avatar tile holding a provider's brand mark — neutral surface + a per-provider
 * coloured ring (keeps the amber/purple identity) with the logo in its own colour.
 */
export function ProviderAvatar({ provider, size = 40 }: { provider: string; size?: number }): JSX.Element {
  const codex = provider === "codex";
  const claude = provider === "claude";
  const ring = codex ? "rgba(245,165,36,0.45)" : claude ? "rgba(167,139,250,0.45)" : "var(--tf-border-strong)";
  const color = codex ? "var(--tf-text)" : claude ? "#c96442" : "var(--tf-text-secondary)";
  return (
    <span
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: "var(--tf-surface-inset)",
        border: `1px solid ${ring}`,
        color,
        flex: "none"
      }}
    >
      <ProviderMark provider={provider} size={Math.round(size * 0.56)} />
    </span>
  );
}
