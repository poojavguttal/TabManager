import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { because, diffTasks, drain, flushTrace, TRACE_KEY, TRACE_MAX, trace } from '../../src/background/trace';
import { NOW, task } from '../helpers';

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  drain();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('diffTasks', () => {
  it('logs created, status changes and deletions with the caller as the default reason', () => {
    const a = task({ key: 'a', status: 'active' });
    const b = task({ key: 'b', status: 'active' });
    diffTasks({ a, b }, { a: { ...a, status: 'done' }, c: task({ key: 'c', rule: 'saved' }) }, 'tick');
    const events = drain();
    expect(events.map((e) => [e.event, e.key, e.detail?.reason])).toEqual([
      ['status', 'a', 'tick'],
      ['created', 'c', 'tick'],
      ['deleted', 'b', 'tick'],
    ]);
    expect(events[0].detail).toMatchObject({ from: 'active', to: 'done' });
  });
  it('uses the reason given with because(), once', () => {
    const a = task({ key: 'a' });
    because('a', 'no new messages any more');
    diffTasks({ a }, {}, 'tick');
    diffTasks({ a }, {}, 'tick');
    expect(drain().map((e) => e.detail?.reason)).toEqual(['no new messages any more', 'tick']);
  });
  it('ignores score-only changes (they happen every minute)', () => {
    const a = task({ key: 'a', score: 0.5 });
    diffTasks({ a }, { a: { ...a, score: 0.7 } }, 'tick');
    expect(drain()).toEqual([]);
  });
});

describe('flushTrace', () => {
  const stubStorage = (initial: unknown[] = []) => {
    const store: Record<string, unknown> = { [TRACE_KEY]: initial };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async (k: string) => ({ [k]: store[k] }),
          set: async (o: Record<string, unknown>) => Object.assign(store, o),
        },
      },
    });
    return store;
  };

  it('appends events and keeps only the newest TRACE_MAX', async () => {
    const store = stubStorage(Array.from({ length: TRACE_MAX }, (_, i) => ({ at: i, kind: 'action', event: 'old' })));
    trace('error', 'boom');
    await flushTrace();
    const log = store[TRACE_KEY] as { event: string }[];
    expect(log).toHaveLength(TRACE_MAX);
    expect(log.at(-1)?.event).toBe('boom');
  });
  it('writes nothing when there is nothing new', async () => {
    const store = stubStorage();
    await flushTrace();
    expect(store[TRACE_KEY]).toEqual([]);
  });
});
