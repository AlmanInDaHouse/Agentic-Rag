import { insertGoal } from "../repositories/goalRepository";

export type GoalDraft = {
  title: string;
};

export function createGoal(input: GoalDraft) {
  return insertGoal(input.title);
}
