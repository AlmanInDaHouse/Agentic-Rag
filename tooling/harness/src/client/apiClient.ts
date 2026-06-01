import {
  createGoalRequestSchema,
  debateRoundWithProposalsSchema,
  goalSchema,
  timelineEventSchema,
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

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Harness API request failed ${response.status}: ${text}`);
    }

    return response.json();
  }
}
