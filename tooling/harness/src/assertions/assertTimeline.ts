import { expect } from "vitest";
import type { TimelineEvent, TimelineEventType } from "@triforge/shared";

export function assertTimelineContains(
  events: TimelineEvent[],
  expectedTypes: TimelineEventType[]
): void {
  const actualTypes = events.map((event) => event.type);
  expect(actualTypes).toEqual(expect.arrayContaining(expectedTypes));
}

export function assertTimelineDoesNotContain(
  events: TimelineEvent[],
  rejectedType: TimelineEventType
): void {
  expect(events.map((event) => event.type)).not.toContain(rejectedType);
}
