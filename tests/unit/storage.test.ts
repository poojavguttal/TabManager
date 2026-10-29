import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../../src/shared/config';
import { NOW, task, visit } from '../helpers';

/** A fake chrome.storage.local that records every write. */
function fakeChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = structuredClone(initial);
  const writes: Record<string, unknown>[] = [];
  const removes: string[][] = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[] | null) => {
          if (keys === null) return structuredClone(store);
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
        set: async (o: Record<string, unknown>) => {
          writes.push(structuredClone(o));
          Object.assign(store, structuredClone(o));
        },
        remove: async (keys: string[]) => {
          removes.push(keys);
          for (const k of keys) delete store[k];
        },
      },
    },
  });
  const bytes = () => writes.filter((w) => !('trace' in w)).reduce((n, w) => n + JSON.stringify(w).length, 0);
  return { store, writes: () => writes.filter((w) => !('trace' in w)), removes, bytes };
}

// The storage module keeps a cache, so each test gets a fresh copy.
const fresh = async () => {
  vi.resetModules();
  return import('../../src/background/storage');
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('storage', () => {
  it('stores each visit under its own key, apart from the rest of the state', async () => {
    const fake = fakeChrome();
    const { update } = await fresh();
    const v = visit();
    await update((s) => {
      s.visits[v.id] = v;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.store[`v:${v.id}`]).toEqual(v);
    expect((fake.store.state as { visits?: unknown }).visits).toBeUndefined();
  });

  it('batches quick updates into one write a few seconds later', async () => {
    const fake = fakeChrome();
    const { update } = await fresh();
    const v = visit();
    for (let i = 0; i < 10; i++) await update((s) => void (s.visits[v.id] = { ...v, activeSec: i }));
    expect(fake.writes()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.writes()).toHaveLength(1);
  });

  it('saves changes to your list immediately', async () => {
    const fake = fakeChrome();
    const { update } = await fresh();
    await update((s) => void (s.tasks.a = task({ key: 'a', rule: 'saved' })), 'added by you');
    expect(fake.store.state).toMatchObject({ tasks: { a: { rule: 'saved' } } });
  });

  it('a page update rewrites only that visit, not the whole history', async () => {
    const visits = Array.from({ length: 80 }, () => visit({ title: 'x'.repeat(200) }));
    const { visits: _, ...state } = emptyState();
    const fake = fakeChrome({ state, ...Object.fromEntries(visits.map((v) => [`v:${v.id}`, v])) });
    const { update } = await fresh();
    await update((s) => void (s.visits[visits[0].id].activeSec += 5));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(Object.keys(fake.writes()[0])).toEqual([`v:${visits[0].id}`]);
    expect(fake.bytes()).toBeLessThan(1_500);
  });

  it('removes keys of visits that were pruned', async () => {
    const v = visit();
    const fake = fakeChrome({ state: {}, [`v:${v.id}`]: v });
    const { update } = await fresh();
    await update((s) => void delete s.visits[v.id]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.removes).toEqual([[`v:${v.id}`]]);
    expect(fake.store[`v:${v.id}`]).toBeUndefined();
  });

  it('moves visits out of the old single-key format without losing anything', async () => {
    const v = visit();
    const t = task({ key: 'a', rule: 'saved' });
    const fake = fakeChrome({ state: { visits: { [v.id]: v }, tasks: { a: t } } });
    const { loadState, update } = await fresh();
    expect((await loadState()).visits[v.id]).toEqual(v);
    await update(() => {});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.store[`v:${v.id}`]).toEqual(v);
    expect(fake.store.state).toMatchObject({ tasks: { a: t } });
    expect((fake.store.state as { visits?: unknown }).visits).toBeUndefined();
  });

  it('a failed update leaves the saved state untouched', async () => {
    const t = task({ key: 'a', rule: 'saved' });
    const fake = fakeChrome({ state: { tasks: { a: t } } });
    const { loadState, update } = await fresh();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      update((s) => {
        delete s.tasks.a;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await loadState()).tasks.a).toEqual(t);
    expect(fake.store.state).toMatchObject({ tasks: { a: t } });
  });
});
