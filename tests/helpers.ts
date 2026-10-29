// Builders for test fixtures. Keep them minimal: each test overrides only what it cares about.
import { DEFAULT_PREFS, emptyState } from '../src/shared/config';
import type { Candidate, InboxEntry, PageSignals, Prefs, State, Task, Visit } from '../src/shared/types';
import { domainOf, normalizeUrl } from '../src/shared/url';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** Fixed clock so results never depend on when the tests run. */
export const NOW = Date.UTC(2026, 9, 29, 15, 0, 0);

export const signals = (o: Partial<PageSignals> = {}): PageSignals => ({
  fieldsFilled: 0,
  fieldsTotal: 0,
  submitted: false,
  draft: 'none',
  scrollMax: 0,
  lastHeading: '',
  videoPct: 0,
  videoDuration: 0,
  completed: false,
  lastKeyAt: 0,
  ...o,
});

let seq = 0;
export function visit(o: Partial<Omit<Visit, 'signals'>> & { signals?: Partial<PageSignals> } = {}): Visit {
  const url = o.url ?? 'https://example.com/page';
  const { signals: sig, ...rest } = o;
  return {
    id: `v${++seq}`,
    tabId: seq,
    url,
    normUrl: normalizeUrl(url),
    domain: domainOf(url),
    title: 'Example page',
    pageType: 'other',
    startedAt: NOW - HOUR,
    lastActiveAt: NOW - 30 * MIN,
    leftAt: NOW - 30 * MIN,
    activeSec: 120,
    lastContentSec: 0,
    closed: false,
    ...rest,
    signals: signals(sig),
  };
}

export function stateWith(visits: Visit[] = [], o: Partial<State> = {}): State {
  const s = emptyState();
  for (const v of visits) {
    s.visits[v.id] = v;
    if (!v.closed) s.tabVisit[v.tabId] = v.id;
  }
  return { ...s, ...o };
}

export function inbox(o: Partial<InboxEntry> & { tabId: number; url: string }): InboxEntry {
  return { appId: 'gmail', account: '', count: 0, seen: 0, ...o };
}

export function task(o: Partial<Task> = {}): Task {
  return {
    key: 'abandoned_form|https://example.com/apply',
    rule: 'abandoned_form',
    status: 'active',
    score: 0.8,
    url: 'https://example.com/apply',
    urls: ['https://example.com/apply'],
    title: 'Apply',
    domain: 'example.com',
    visitIds: [],
    evidence: [],
    meta: {},
    label: 'Apply',
    note: 'Form not complete',
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    leftAt: NOW - HOUR,
    nudgeCount: 0,
    ...o,
  };
}

export function candidate(o: Partial<Candidate> = {}): Candidate {
  return {
    key: 'abandoned_form|https://example.com/apply',
    rule: 'abandoned_form',
    score: 0.8,
    evidence: [],
    visitIds: [],
    url: 'https://example.com/apply',
    urls: ['https://example.com/apply'],
    title: 'Apply',
    domain: 'example.com',
    leftAt: NOW - HOUR,
    meta: {},
    ...o,
  };
}

export const prefs = (o: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, ...o });
