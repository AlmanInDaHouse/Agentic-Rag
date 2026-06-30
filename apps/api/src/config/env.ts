import { z } from "zod";
import { validateDbSchemaName } from "../db/schema.js";

const localEmbeddingEndpointSchema = z
  .preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z.string().url().optional()
  )
  .refine(
    (endpoint) => endpoint === undefined || isLocalEndpoint(endpoint),
    "TRIFORGE_LOCAL_EMBEDDING_ENDPOINT must point to localhost or loopback"
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://triforge:triforge@localhost:5432/triforge"),
  // Integrated runtime provider selection (A10-W.8b). `mock` (the default) keeps every
  // integrated run deterministic for tests, demos, CI and offline development. `real`
  // routes the integrated run through the capability-gated real Codex/Claude adapters
  // on the native Windows substrate. There is NO silent real->mock fallback: when `real`
  // is selected and a provider cannot run, the run terminates failed/blocked/unavailable.
  TRIFORGE_PROVIDER_MODE: z.enum(["mock", "real"]).default("mock"),
  TRIFORGE_MOCK_AGENT_FAILURE_MODE: z
    .enum(["none", "one_invalid", "all_invalid"])
    .default("none"),
  TRIFORGE_DB_SCHEMA: z
    .string()
    .default("public")
    .transform((schemaName) => validateDbSchemaName(schemaName)),
  TRIFORGE_EMBEDDING_PROVIDER: z
    .enum(["mock", "local"])
    .default("mock"),
  TRIFORGE_LOCAL_EMBEDDING_ENDPOINT: localEmbeddingEndpointSchema,
  TRIFORGE_LOCAL_EMBEDDING_DIMENSION: z.coerce
    .number()
    .int()
    .positive()
    .max(4096)
    .default(32),
  TRIFORGE_EMBEDDING_STORAGE: z
    .enum(["jsonb", "pgvector"])
    .default("jsonb")
});

export function parseEnv(input: NodeJS.ProcessEnv) {
  return envSchema.parse(input);
}

export const env = parseEnv(process.env);

function isLocalEndpoint(endpoint: string): boolean {
  const hostname = new URL(endpoint).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}
