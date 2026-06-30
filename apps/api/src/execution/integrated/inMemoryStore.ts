/**
 * In-memory IntegratedRunStore (A10-W.8b) — backs unit tests, CI and offline runs.
 * Values are structurally cloned on the way in and out so a returned record can never
 * be mutated through a live reference, mimicking the round-trip through a real database
 * (the Pg store is the durable, restart-surviving implementation).
 */

import type {
  IntegratedRunEvent,
  IntegratedRunPatch,
  IntegratedRunRecord,
  IntegratedRunStore
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryIntegratedRunStore implements IntegratedRunStore {
  private readonly runs = new Map<string, IntegratedRunRecord>();
  private readonly events = new Map<string, IntegratedRunEvent[]>();

  async create(record: IntegratedRunRecord): Promise<void> {
    if (this.runs.has(record.id)) {
      throw new Error(`integrated run ${record.id} already exists`);
    }
    this.runs.set(record.id, clone(record));
    this.events.set(record.id, []);
  }

  async get(id: string): Promise<IntegratedRunRecord | null> {
    const record = this.runs.get(id);
    return record ? clone(record) : null;
  }

  async patch(id: string, patch: IntegratedRunPatch): Promise<void> {
    const record = this.runs.get(id);
    if (!record) {
      throw new Error(`integrated run ${id} not found`);
    }
    this.runs.set(id, clone({ ...record, ...patch }));
  }

  async appendEvent(runId: string, event: IntegratedRunEvent): Promise<void> {
    const list = this.events.get(runId);
    if (!list) {
      throw new Error(`integrated run ${runId} not found`);
    }
    if (list.some((e) => e.sequenceNumber === event.sequenceNumber)) {
      throw new Error(`duplicate sequence ${event.sequenceNumber} for run ${runId}`);
    }
    list.push(clone(event));
  }

  async listEvents(runId: string): Promise<IntegratedRunEvent[]> {
    const list = this.events.get(runId) ?? [];
    return clone(list).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async maxSequence(runId: string): Promise<number> {
    const list = this.events.get(runId) ?? [];
    return list.reduce((max, e) => Math.max(max, e.sequenceNumber), 0);
  }
}
