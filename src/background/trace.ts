// Developer trace: a local, size-capped log of every decision that changes your list, so a bug
// ("where did my to-do go?") can be answered from the log instead of guessed at.
// Every task change is caught by diffing tasks before/after each state update, so nothing slips
// through untraced; `because()` attaches the reason when the code that made the change knows it.
// Stays in chrome.storage.local like everything else. Download it from Settings → Debug.
import type { Task } from '../shared/types';

export type TraceKind = 'task' | 'nudge' | 'lifecycle' | 'action' | 'error';

export interface TraceEvent {
  at: number;
  kind: TraceKind;
  event: string;
  key?: string;
  detail?: Record<string, string | number | boolean | undefined>;
}

export const TRACE_KEY = 'trace';
export const TRACE_MAX = 1000;

let pending: TraceEvent[] = [];
const reasons = new Map<string, string>();

export function trace(kind: TraceKind, event: string, key?: string, detail?: TraceEvent['detail']) {
  const e: TraceEvent = { at: Date.now(), kind, event, key, detail };
  pending.push(e);
  console.debug('[tab-todos]', kind, event, key ?? '', detail ?? '');
}

/** Explains the change about to be made to this task; picked up by the next diff. */
export function because(key: string, reason: string) {
  reasons.set(key, reason);
}

/** Logs tasks created, deleted, or moved to another status. `source` is the default reason. */
export function diffTasks(before: Record<string, Task>, after: Record<string, Task>, source: string) {
  const why = (key: string) => reasons.get(key) ?? source;
  for (const [key, t] of Object.entries(after)) {
    const old = before[key];
    if (!old) trace('task', 'created', key, { rule: t.rule, status: t.status, score: round(t.score), title: t.title, reason: why(key) });
    else if (old.status !== t.status) trace('task', 'status', key, { from: old.status, to: t.status, score: round(t.score), reason: why(key) });
  }
  for (const [key, t] of Object.entries(before)) {
    if (!after[key]) trace('task', 'deleted', key, { rule: t.rule, status: t.status, title: t.title, reason: why(key) });
  }
  reasons.clear();
}

/** Takes the events collected so far (for writing to storage). */
export function drain(): TraceEvent[] {
  const out = pending;
  pending = [];
  return out;
}

let chain: Promise<unknown> = Promise.resolve();

export function flushTrace(): Promise<void> {
  const run = chain.then(async () => {
    const events = drain();
    if (!events.length) return;
    const { [TRACE_KEY]: log = [] } = await chrome.storage.local.get(TRACE_KEY);
    await chrome.storage.local.set({ [TRACE_KEY]: [...(log as TraceEvent[]), ...events].slice(-TRACE_MAX) });
  });
  chain = run.catch((err) => console.error('[tab-todos] trace write failed', err));
  return run;
}

const round = (n: number) => Math.round(n * 100) / 100;
