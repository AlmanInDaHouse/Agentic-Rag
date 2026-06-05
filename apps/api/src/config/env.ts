import { z } from "zod";
import { validateDbSchemaName } from "../db/schema.js";

const localEmbeddingEndpointSchema = z
  .preprocess(
    (value) => value === "" ? undefined : value,
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
    hostname === "host.docker.internal" ||
    hostname.startsWith("127.")
  );
}
