import { DEFAULT_PREFS, emptyState } from '../shared/config';
import type { Prefs, State } from '../shared/types';
import { diffTasks, flushTrace, trace } from './trace';

// MV3 service workers get killed when idle, so nothing important lives in memory.
// All state mutations go through `update`, which serializes them to avoid
// read-modify-write races between concurrent tab events.

let chain: Promise<unknown> = Promise.resolve();

export async function loadState(): Promise<State> {
  const { state } = await chrome.storage.local.get('state');
  return { ...emptyState(), ...(state as Partial<State> | undefined) };
}

/** `source` names the caller in the trace log, for task changes that don't give their own reason. */
export function update<T>(fn: (s: State) => T | Promise<T>, source = 'update'): Promise<T> {
  const run = chain.then(async () => {
    const s = await loadState();
    const before = structuredClone(s.tasks);
    const result = await fn(s);
    diffTasks(before, s.tasks, source);
    await chrome.storage.local.set({ state: s });
    await flushTrace();
    return result;
  });
  chain = run.catch((err) => {
    console.error('[tab-todos] state update failed', err);
    trace('error', 'state update failed', undefined, { source, message: String(err) });
    void flushTrace();
  });
  return run;
}

export async function loadPrefs(): Promise<Prefs> {
  const { prefs } = await chrome.storage.local.get('prefs');
  return { ...DEFAULT_PREFS, ...(prefs as Partial<Prefs> | undefined) };
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const prefs = { ...(await loadPrefs()), ...patch };
  await chrome.storage.local.set({ prefs });
  return prefs;
}
