import {
  AgentRunSchema,
  AgentRunWithDetailsSchema,
  ApprovalGateSchema,
  CreateAgentRunSchema,
  ResolveApprovalGateSchema,
  createGoalRequestSchema,
  debateRoundWithProposalsSchema,
  goalSchema,
  timelineEventSchema,
  type AgentRun,
  type AgentRunWithDetails,
  type ApprovalGate,
  type CreateAgentRun,
  type CreateGoalRequest,
  type DebateRoundWithProposals,
  type Goal,
  type TimelineEvent
} from "@triforge/shared";

export class HarnessApiClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { status?: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }

  async createGoal(input: CreateGoalRequest): Promise<Goal> {
    const parsed = createGoalRequestSchema.parse(input);
    const body = await this.request("/api/goals", {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return goalSchema.parse(body);
  }

  async runDebate(goalId: string): Promise<DebateRoundWithProposals> {
    const body = await this.request(`/api/goals/${goalId}/debate-rounds`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return debateRoundWithProposalsSchema.parse(body);
  }

  async latestDebate(goalId: string): Promise<DebateRoundWithProposals> {
    const body = await this.request(`/api/goals/${goalId}/debate-rounds/latest`);
    return debateRoundWithProposalsSchema.parse(body);
  }

  async timeline(goalId: string): Promise<TimelineEvent[]> {
    const body = await this.request(`/api/goals/${goalId}/timeline`);
    return timelineEventSchema.array().parse(body);
  }

  async createRun(goalId: string, input: CreateAgentRun): Promise<AgentRunWithDetails> {
    const parsed = CreateAgentRunSchema.parse(input);
    const body = await this.request(`/api/goals/${goalId}/runs`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async listRuns(goalId: string): Promise<AgentRun[]> {
    const body = await this.request(`/api/goals/${goalId}/runs`);
    return AgentRunSchema.array().parse(body);
  }

  async getRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}`);
    return AgentRunWithDetailsSchema.parse(body);
  }

  async startRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}/start`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async startRunStatus(runId: string, body: unknown = {}): Promise<number> {
    const response = await this.rawRequest(`/api/runs/${runId}/start`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async advanceRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}/advance`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async cancelRun(runId: string): Promise<AgentRunWithDetails> {
    const body = await this.request(`/api/runs/${runId}/cancel`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async listApprovalGates(runId: string): Promise<ApprovalGate[]> {
    const body = await this.request(`/api/runs/${runId}/approval-gates`);
    return ApprovalGateSchema.array().parse(body);
  }

  async approveGate(
    gateId: string,
    input: { resolvedBy: string; actorRole: "human_operator" | "admin" | "system"; reason: string }
  ): Promise<AgentRunWithDetails> {
    const parsed = ResolveApprovalGateSchema.parse(input);
    const body = await this.request(`/api/approval-gates/${gateId}/approve`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async rejectGate(
    gateId: string,
    input: { resolvedBy: string; actorRole: "human_operator" | "admin" | "system"; reason: string }
  ): Promise<AgentRunWithDetails> {
    const parsed = ResolveApprovalGateSchema.parse(input);
    const body = await this.request(`/api/approval-gates/${gateId}/reject`, {
      method: "POST",
      body: JSON.stringify(parsed)
    });
    return AgentRunWithDetailsSchema.parse(body);
  }

  async advanceRunStatus(runId: string): Promise<number> {
    const response = await this.rawRequest(`/api/runs/${runId}/advance`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await response.text();
    return response.status;
  }

  async approveGateStatus(gateId: string, body: unknown): Promise<number> {
    const response = await this.rawRequest(`/api/approval-gates/${gateId}/approve`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  async rejectGateStatus(gateId: string, body: unknown): Promise<number> {
    const response = await this.rawRequest(`/api/approval-gates/${gateId}/reject`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    await response.text();
    return response.status;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.rawRequest(path, init);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Harness API request failed ${response.status}: ${text}`);
    }

    return response.json();
  }

  private async rawRequest(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers
      }
    });
  }
}
