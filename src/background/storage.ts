import { DEFAULT_PREFS, emptyState } from '../shared/config';
import type { Prefs, State, Visit } from '../shared/types';
import { diffTasks, flushTrace, trace } from './trace';

// MV3 service workers get killed when idle, so everything is persisted to chrome.storage.local.
// All state mutations go through `update`, which serializes them to avoid read-modify-write races.
//
// Disk writes are kept small:
// - Each visit is stored under its own key ("v:<id>"); everything else lives under "state".
//   Only the parts whose JSON actually changed are written — a page report rewrites one ~1 KB visit, not the whole state.
// - The state is cached in memory while the worker is alive and saved a few seconds after the last change,
//   so a burst of tab events becomes one write. Changes to your list are saved immediately.

export const VISIT_PREFIX = 'v:';
const SAVE_DELAY_MS = 5_000;

let chain: Promise<unknown> = Promise.resolve();
let cache: State | null = null;
/** Storage key → JSON last written, to skip writing parts that didn't change. */
const saved = new Map<string, string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function load(): Promise<State> {
  if (cache) return cache;
  const all = await chrome.storage.local.get(null);
  const stored = (all.state ?? {}) as Partial<State>;
  // Older versions kept visits inside "state"; they move to their own keys on the next save.
  const visits: Record<string, Visit> = { ...(stored.visits ?? {}) };
  saved.clear();
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(VISIT_PREFIX)) continue;
    visits[k.slice(VISIT_PREFIX.length)] = v as Visit;
    saved.set(k, JSON.stringify(v));
  }
  if (all.state) saved.set('state', JSON.stringify(all.state));
  cache = { ...emptyState(), ...stored, visits };
  return cache;
}

/** Read-only view of the current state. */
export function loadState(): Promise<State> {
  return chain.then(load);
}

async function persist() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!cache) return;
  const { visits, ...rest } = cache;
  const writes: Record<string, unknown> = {};
  const next = new Map<string, string>();

  const restJson = JSON.stringify(rest);
  if (saved.get('state') !== restJson) {
    writes.state = rest;
    next.set('state', restJson);
  }
  for (const [id, v] of Object.entries(visits)) {
    const key = VISIT_PREFIX + id;
    const json = JSON.stringify(v);
    if (saved.get(key) !== json) {
      writes[key] = v;
      next.set(key, json);
    }
  }
  const removed = [...saved.keys()].filter((k) => k.startsWith(VISIT_PREFIX) && !(k.slice(VISIT_PREFIX.length) in visits));

  if (Object.keys(writes).length) await chrome.storage.local.set(writes);
  if (removed.length) await chrome.storage.local.remove(removed);
  for (const [k, json] of next) saved.set(k, json);
  for (const k of removed) saved.delete(k);
}

function scheduleSave() {
  saveTimer ??= setTimeout(() => {
    chain = chain.then(persist).catch((err) => console.error('[tab-todos] save failed', err));
  }, SAVE_DELAY_MS);
}

/** `source` names the caller in the trace log, for task changes that don't give their own reason. */
export function update<T>(fn: (s: State) => T | Promise<T>, source = 'update'): Promise<T> {
  const run = chain.then(async () => {
    const s = await load();
    const before = structuredClone(s.tasks);
    let result: T;
    try {
      result = await fn(s);
    } catch (err) {
      // The cached copy may be half-changed: drop it and start again from what's on disk.
      cache = null;
      throw err;
    }
    // Your list is saved right away; visit bookkeeping can wait for the next batch.
    if (diffTasks(before, s.tasks, source)) await persist();
    else scheduleSave();
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
