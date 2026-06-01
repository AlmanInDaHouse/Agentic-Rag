import type { Agent, ProposalDraft } from "../domain/ports.js";

export type MockAgentFailureMode = "none" | "one_invalid" | "all_invalid";

function invalidDraft(agentId: Agent["id"]): ProposalDraft {
  return {
    agentId,
    proposal: "",
    confidence: 2
  };
}

export function createMockAgents(failureMode: MockAgentFailureMode = "none"): Agent[] {
  const shouldFail = (agentId: Agent["id"]): boolean =>
    failureMode === "all_invalid" ||
    (failureMode === "one_invalid" && agentId === "codex_architect");

  return [
    {
      id: "codex_architect",
      async propose(goal, roundNumber): Promise<ProposalDraft> {
        if (shouldFail("codex_architect")) {
          return invalidDraft("codex_architect");
        }

        return {
          agentId: "codex_architect",
          proposal: [
            `Round ${roundNumber}: design a modular execution plan for "${goal.title}".`,
            "Prioritize explicit contracts, small services, observable execution state, and adapter boundaries."
          ].join(" "),
          confidence: 0.86
        };
      }
    },
    {
      id: "claude_critic",
      async propose(goal, roundNumber): Promise<ProposalDraft> {
        if (shouldFail("claude_critic")) {
          return invalidDraft("claude_critic");
        }

        return {
          agentId: "claude_critic",
          proposal: [
            `Round ${roundNumber}: challenge the goal "${goal.title}" before expanding scope.`,
            "Identify missing acceptance criteria, failure modes, data retention risks, and test gaps."
          ].join(" "),
          confidence: 0.81
        };
      }
    },
    {
      id: "gemini_researcher",
      async propose(goal, roundNumber): Promise<ProposalDraft> {
        if (shouldFail("gemini_researcher")) {
          return invalidDraft("gemini_researcher");
        }

        return {
          agentId: "gemini_researcher",
          proposal: [
            `Round ${roundNumber}: gather external context for "${goal.title}".`,
            "Compare options, list assumptions, and recommend the smallest evidence-backed next step."
          ].join(" "),
          confidence: 0.78
        };
      }
    }
  ];
}

export const mockAgents: Agent[] = createMockAgents();
