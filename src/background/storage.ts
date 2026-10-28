import { DEFAULT_PREFS, emptyState } from '../shared/config';
import type { Prefs, State } from '../shared/types';

// MV3 service workers get killed when idle, so nothing important lives in memory.
// All state mutations go through `update`, which serializes them to avoid
// read-modify-write races between concurrent tab events.

let chain: Promise<unknown> = Promise.resolve();

export async function loadState(): Promise<State> {
  const { state } = await chrome.storage.local.get('state');
  return { ...emptyState(), ...(state as Partial<State> | undefined) };
}

export function update<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = await loadState();
    const result = await fn(s);
    await chrome.storage.local.set({ state: s });
    return result;
  });
  chain = run.catch((err) => console.error('[tab-resume] state update failed', err));
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
