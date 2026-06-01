import { z } from "zod";
import { validateDbSchemaName } from "../db/schema.js";

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
    .transform((schemaName) => validateDbSchemaName(schemaName))
});

export const env = envSchema.parse(process.env);
