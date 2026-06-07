import { createGoal } from "../services/goalService";

export function testCreateGoal() {
  return createGoal({ title: "fixture" });
}
