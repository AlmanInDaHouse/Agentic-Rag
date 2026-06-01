import pg from "pg";
import { env } from "../config/env.js";
import { searchPathOption } from "./schema.js";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  options: `-c search_path=${searchPathOption(env.TRIFORGE_DB_SCHEMA)}`
});

export type DbPool = Pick<pg.Pool, "query">;
