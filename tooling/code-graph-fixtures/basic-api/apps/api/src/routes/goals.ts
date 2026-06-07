import type { GoalInput } from "../../../../packages/shared/src/index";
import { createGoal } from "../services/goalService";

export function registerGoalRoutes(fastify: { post: (path: string, handler: unknown) => void }) {
  fastify.post("/api/goals", async () => createGoal({ title: "fixture" } as GoalInput));
}
