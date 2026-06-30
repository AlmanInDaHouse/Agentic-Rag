/**
 * Integrated runtime HTTP API (A10-W.8b). The product run path: submit a task, pick a
 * provider + collaboration mode + budget + allowed paths, start, then poll the
 * sequence-numbered timeline / artifacts / diff, cancel, or recover. Every input is
 * re-validated on the backend (never trust the client), and a run may only target a
 * DISPOSABLE fixture repo OUTSIDE the TriForge tree (mandate §9).
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { IntegratedRunService } from "../execution/integrated/index.js";
import type { IntegratedRunSpec } from "../execution/integrated/index.js";
import type { ProviderMode } from "../providers/configuredAdapter.js";

const providerEnum = z.enum(["codex", "claude"]);
const gateSchema = z.object({
  name: z.enum(["custom", "build", "unit", "integration", "e2e", "typecheck", "lint", "dependency", "security", "codeGraph"]),
  command: z.object({ bin: z.string().min(1).max(128), args: z.array(z.string().max(512)).max(32) })
});

const createSchema = z.object({
  objective: z.string().min(1).max(8000),
  owner: providerEnum,
  reviewer: providerEnum,
  providerMode: z.enum(["mock", "real"]).optional(),
  collaborationMode: z.enum(["specialist", "pair"]).default("specialist"),
  fixtureRepoPath: z.string().min(1).max(4096),
  writePaths: z.array(z.string().min(1).max(512)).min(1).max(50),
  readPaths: z.array(z.string().min(1).max(512)).max(50).default(["."]),
  blockedPaths: z.array(z.string().min(1).max(512)).max(50).default([]),
  maxFilesChanged: z.number().int().positive().max(200).default(10),
  gates: z.array(gateSchema).max(16).default([]),
  ownerModel: z.string().max(128).nullable().default(null),
  reviewerModel: z.string().max(128).nullable().default(null),
  budget: z
    .object({
      maxRepairRounds: z.number().int().min(0).max(5).default(2),
      perRunTimeoutMs: z.number().int().positive().max(1_800_000).default(240_000)
    })
    .default({ maxRepairRounds: 2, perRunTimeoutMs: 240_000 })
});

const runParams = z.object({ id: z.string().uuid() });

function sendZod(reply: FastifyReply, error: z.ZodError): void {
  reply.status(400).send({ error: "bad_request", message: error.issues.map((i) => i.message).join("; ") });
}

/** True if `target` is the repo root or nested inside it (case-insensitive on Windows). */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  const norm = process.platform === "win32" ? rel.toLowerCase() : rel;
  return !norm.startsWith(`..${path.sep}`) && norm !== ".." && !path.isAbsolute(rel);
}

export interface IntegratedRoutesOptions {
  /** The TriForge repo root; a run may NOT target it (or anything inside it). */
  repoRoot: string;
  /** Default provider mode when the request omits one (from env). */
  defaultProviderMode: ProviderMode;
}

export function registerIntegratedRoutes(
  app: FastifyInstance,
  service: IntegratedRunService,
  options: IntegratedRoutesOptions
): void {
  // Create a run (does not execute).
  app.post("/api/integrated-runs", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      sendZod(reply, parsed.error);
      return;
    }
    const body = parsed.data;

    // Security: the fixture repo must be a real, absolute git repo OUTSIDE the TriForge tree.
    const fixture = path.resolve(body.fixtureRepoPath);
    if (!path.isAbsolute(body.fixtureRepoPath)) {
      reply.status(400).send({ error: "bad_request", message: "fixtureRepoPath must be an absolute path" });
      return;
    }
    if (isWithin(options.repoRoot, fixture)) {
      reply.status(400).send({ error: "forbidden_target", message: "a run may not target the TriForge repository; use a disposable fixture repo" });
      return;
    }
    if (!existsSync(fixture) || !statSync(fixture).isDirectory() || !existsSync(path.join(fixture, ".git"))) {
      reply.status(400).send({ error: "bad_request", message: "fixtureRepoPath must be an existing git repository" });
      return;
    }

    const spec: IntegratedRunSpec = {
      objective: body.objective,
      owner: body.owner,
      reviewer: body.reviewer,
      providerMode: body.providerMode ?? options.defaultProviderMode,
      collaborationMode: body.collaborationMode,
      fixtureRepoPath: fixture,
      writePaths: body.writePaths,
      readPaths: body.readPaths,
      blockedPaths: body.blockedPaths,
      maxFilesChanged: body.maxFilesChanged,
      gates: body.gates,
      ownerModel: body.ownerModel,
      reviewerModel: body.reviewerModel,
      budget: body.budget
    };
    const record = await service.create(spec);
    reply.status(201).send({ id: record.id, status: record.status, spec: record.spec });
  });

  // Start a created run (async; poll the timeline for progress).
  app.post("/api/integrated-runs/:id/start", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = runParams.safeParse(request.params);
    if (!params.success) {
      sendZod(reply, params.error);
      return;
    }
    const current = await service.get(params.data.id);
    if (!current) {
      reply.status(404).send({ error: "not_found", message: "run not found" });
      return;
    }
    if (current.status !== "created") {
      reply.status(409).send({ error: "conflict", message: `run is ${current.status}, not startable` });
      return;
    }
    // Fire-and-forget: start() persists its own terminal state + errors.
    void service.start(params.data.id).catch(() => {
      /* terminal state is recorded inside start() */
    });
    reply.status(202).send({ id: params.data.id, status: "running" });
  });

  const getRun = (handler: (id: string, reply: FastifyReply) => Promise<void>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = runParams.safeParse(request.params);
      if (!params.success) {
        sendZod(reply, params.error);
        return;
      }
      await handler(params.data.id, reply);
    };

  app.get("/api/integrated-runs/:id", getRun(async (id, reply) => {
    const record = await service.get(id);
    if (!record) {
      reply.status(404).send({ error: "not_found", message: "run not found" });
      return;
    }
    reply.send(record);
  }));

  app.get("/api/integrated-runs/:id/timeline", getRun(async (id, reply) => {
    const record = await service.get(id);
    if (!record) {
      reply.status(404).send({ error: "not_found", message: "run not found" });
      return;
    }
    reply.send({ events: await service.timeline(id) });
  }));

  app.get("/api/integrated-runs/:id/artifacts", getRun(async (id, reply) => {
    const artifacts = await service.artifacts(id);
    if (!artifacts) {
      reply.status(404).send({ error: "not_found", message: "run not found" });
      return;
    }
    reply.send(artifacts);
  }));

  app.get("/api/integrated-runs/:id/diff", getRun(async (id, reply) => {
    const diff = await service.diff(id);
    if (!diff) {
      reply.status(404).send({ error: "not_found", message: "run not found" });
      return;
    }
    reply.send(diff);
  }));

  app.post("/api/integrated-runs/:id/cancel", getRun(async (id, reply) => {
    const existing = await service.get(id);
    if (!existing) {
      reply.status(404).send({ error: "not_found", message: "run not found" });
      return;
    }
    reply.send(await service.cancel(id));
  }));

  app.post("/api/integrated-runs/:id/recover", getRun(async (id, reply) => {
    const existing = await service.get(id);
    if (!existing) {
      reply.status(404).send({ error: "not_found", message: "run not found" });
      return;
    }
    reply.send(await service.recover(id));
  }));
}
