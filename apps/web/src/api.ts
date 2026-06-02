import {
  AgentRunSchema,
  AgentRunWithDetailsSchema,
  CreateAgentRunSchema,
  createGoalRequestSchema,
  debateRoundWithProposalsSchema,
  goalSchema,
  timelineEventSchema,
  type AgentRun,
  type AgentRunWithDetails,
  type CreateAgentRun,
  type CreateGoalRequest,
  type DebateRoundWithProposals,
  type Goal,
  type TimelineEvent
} from "@triforge/shared";
import { z } from "zod";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listGoals(): Promise<Goal[]> {
  const body = await request<unknown>("/api/goals");
  return z.array(goalSchema).parse(body);
}

export async function createGoal(input: CreateGoalRequest): Promise<Goal> {
  const parsed = createGoalRequestSchema.parse(input);
  const body = await request<unknown>("/api/goals", {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return goalSchema.parse(body);
}

export async function runDebate(goalId: string): Promise<DebateRoundWithProposals> {
  const body = await request<unknown>(`/api/goals/${goalId}/debate-rounds`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return debateRoundWithProposalsSchema.parse(body);
}

export async function getLatestDebate(goalId: string): Promise<DebateRoundWithProposals | null> {
  try {
    const body = await request<unknown>(`/api/goals/${goalId}/debate-rounds/latest`);
    return debateRoundWithProposalsSchema.parse(body);
  } catch (error) {
    if (error instanceof Error && error.message.includes("No debate round found")) {
      return null;
    }
    throw error;
  }
}

export async function getTimeline(goalId: string): Promise<TimelineEvent[]> {
  const body = await request<unknown>(`/api/goals/${goalId}/timeline`);
  return z.array(timelineEventSchema).parse(body);
}

export async function createRun(
  goalId: string,
  input: CreateAgentRun
): Promise<AgentRunWithDetails> {
  const parsed = CreateAgentRunSchema.parse(input);
  const body = await request<unknown>(`/api/goals/${goalId}/runs`, {
    method: "POST",
    body: JSON.stringify(parsed)
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function listRuns(goalId: string): Promise<AgentRun[]> {
  const body = await request<unknown>(`/api/goals/${goalId}/runs`);
  return z.array(AgentRunSchema).parse(body);
}

export async function getRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}`);
  return AgentRunWithDetailsSchema.parse(body);
}

export async function startRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}/start`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function advanceRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}/advance`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return AgentRunWithDetailsSchema.parse(body);
}

export async function cancelRun(runId: string): Promise<AgentRunWithDetails> {
  const body = await request<unknown>(`/api/runs/${runId}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
  });
  return AgentRunWithDetailsSchema.parse(body);
}
