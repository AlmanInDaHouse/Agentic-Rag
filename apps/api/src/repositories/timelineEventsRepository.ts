import type { TimelineEvent } from "@triforge/shared";
import type { DbQueryable } from "../db/pool.js";
import type { TimelineEventInput, TimelineEventsRepository } from "../domain/ports.js";
import { mapTimelineEvent } from "./mappers.js";

export class PgTimelineEventsRepository implements TimelineEventsRepository {
  constructor(private readonly db: DbQueryable) {}

  async create(input: TimelineEventInput): Promise<TimelineEvent> {
    const result = await this.db.query(
      `
        INSERT INTO timeline_events (goal_id, type, message, payload)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [input.goalId, input.type, input.message, JSON.stringify(input.payload ?? {})]
    );
    return mapTimelineEvent(result.rows[0]);
  }

  async listByGoal(goalId: string): Promise<TimelineEvent[]> {
    const result = await this.db.query(
      `
        SELECT *
        FROM timeline_events
        WHERE goal_id = $1
        ORDER BY created_at ASC
      `,
      [goalId]
    );
    return result.rows.map(mapTimelineEvent);
  }
}
