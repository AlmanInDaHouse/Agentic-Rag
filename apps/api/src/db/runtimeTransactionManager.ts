import type { DbPool } from "./pool.js";
import type {
  AgentRuntimeRepositories,
  AgentRuntimeTransactionManager
} from "../domain/ports.js";
import { PgAgentRunRepository } from "../repositories/agentRunRepository.js";
import { PgAgentStepRepository } from "../repositories/agentStepRepository.js";
import { PgApprovalGateRepository } from "../repositories/approvalGateRepository.js";
import { PgTimelineEventsRepository } from "../repositories/timelineEventsRepository.js";

export class PgAgentRuntimeTransactionManager implements AgentRuntimeTransactionManager {
  constructor(private readonly db: DbPool) {}

  async run<T>(callback: (repositories: AgentRuntimeRepositories) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const repositories: AgentRuntimeRepositories = {
        agentRunRepository: new PgAgentRunRepository(client),
        agentStepRepository: new PgAgentStepRepository(client),
        approvalGateRepository: new PgApprovalGateRepository(client),
        timelineEventsRepository: new PgTimelineEventsRepository(client)
      };
      const result = await callback(repositories);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
