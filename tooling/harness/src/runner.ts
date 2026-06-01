import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessApiClient } from "./client/apiClient.js";
import {
  createHarnessSchema,
  createHarnessSchemaIdentity,
  dropHarnessSchema,
  type HarnessSchema
} from "./db/schemaIsolation.js";

export type HarnessAgentFailureMode = "none" | "one_invalid" | "all_invalid";

export type HarnessRuntime = {
  api: HarnessApiClient;
  baseUrl: string;
  runId: string;
  schemaName: string;
  stop: () => Promise<void>;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const corepackBin = process.platform === "win32" ? "corepack.cmd" : "corepack";
const defaultDatabaseUrl = "postgres://triforge:triforge@localhost:5432/triforge";

export async function startHarnessRuntime(options: {
  port?: number;
  failureMode?: HarnessAgentFailureMode;
}): Promise<HarnessRuntime> {
  const databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl;
  const schema = createHarnessSchemaIdentity();
  const port = options.port ?? (await getFreePort());
  let child: ChildProcessWithoutNullStreams | null = null;

  logHarness(`starting runId=${schema.runId} schema=${schema.schemaName} apiPort=${port}`);

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await createHarnessSchema(databaseUrl, schema.schemaName);
    await runPnpm(["--filter", "@triforge/api", "db:migrate"], {
      DATABASE_URL: databaseUrl,
      TRIFORGE_DB_SCHEMA: schema.schemaName
    });

    child = spawnApiProcess(port, schema, databaseUrl, options.failureMode ?? "none");
    const api = new HarnessApiClient(baseUrl);
    await waitForApi(api, child, port);

    return {
      api,
      baseUrl,
      runId: schema.runId,
      schemaName: schema.schemaName,
      stop: async () => {
        await cleanupRuntime(databaseUrl, schema.schemaName, child, port, "stop");
      }
    };
  } catch (error) {
    await cleanupRuntime(databaseUrl, schema.schemaName, child, port, "startup_failed");
    throw error;
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a free port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function spawnApiProcess(
  port: number,
  schema: HarnessSchema,
  databaseUrl: string,
  failureMode: HarnessAgentFailureMode
): ChildProcessWithoutNullStreams {
  const child = spawn(
    corepackBin,
    ["pnpm", "--filter", "@triforge/api", "exec", "tsx", "src/index.ts"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        HOST: "127.0.0.1",
        PORT: String(port),
        TRIFORGE_DB_SCHEMA: schema.schemaName,
        TRIFORGE_MOCK_AGENT_FAILURE_MODE: failureMode
      },
      stdio: "pipe",
      shell: process.platform === "win32",
      windowsHide: true
    }
  );

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[harness-api:${port}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[harness-api:${port}] ${chunk}`);
  });

  return child;
}

async function waitForApi(
  api: HarnessApiClient,
  child: ChildProcessWithoutNullStreams,
  port: number
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Harness API process on port ${port} exited with code ${child.exitCode}`);
    }
    if (await api.health()) {
      return;
    }
    await delay(500);
  }

  throw new Error(`Harness API on port ${port} did not become healthy`);
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    await killWindowsProcessTree(child.pid);
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(5_000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    })
  ]);
}

function killWindowsProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("exit", () => resolve());
    killer.once("error", () => resolve());
  });
}

async function cleanupRuntime(
  databaseUrl: string,
  schemaName: string,
  child: ChildProcessWithoutNullStreams | null,
  port: number,
  result: string
): Promise<void> {
  let cleanupStatus = "not_started";
  try {
    if (child) {
      await stopProcess(child);
    }
    await dropHarnessSchema(databaseUrl, schemaName);
    cleanupStatus = "dropped";
  } catch (error) {
    cleanupStatus = error instanceof Error ? `failed:${error.message}` : "failed:unknown";
    throw error;
  } finally {
    logHarness(`completed schema=${schemaName} apiPort=${port} result=${result} cleanup=${cleanupStatus}`);
  }
}

function logHarness(message: string): void {
  process.stderr.write(`[harness] ${message}\n`);
}

function runPnpm(args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(corepackBin, ["pnpm", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env
      },
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`corepack pnpm ${args.join(" ")} failed with exit code ${code}`));
    });
    child.once("error", reject);
  });
}
