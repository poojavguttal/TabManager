// Task state machine: candidate → active → nudged → resumed / snoozed / done / dismissed / expired.
import { CONFIG } from '../shared/config';
import type { Candidate, State, Task, TaskStatus } from '../shared/types';
import { domainOf, normalizeUrl } from '../shared/url';
import { templateLabel } from './labels';

const DAY = 86_400_000;
export const FINISHED: ReadonlySet<TaskStatus> = new Set(['done', 'dismissed', 'expired']);
export const VISIBLE: ReadonlySet<TaskStatus> = new Set(['active', 'nudged', 'resumed', 'snoozed']);

export const isShown = (t: Task) => VISIBLE.has(t.status) && t.score >= CONFIG.showThreshold;
/** Counts toward the badge and reminders. */
export const isPending = (t: Task) => (t.status === 'active' || t.status === 'nudged') && t.score >= CONFIG.showThreshold;

export function merge(s: State, candidates: Candidate[], now: number) {
  const seen = new Set<string>();

  for (const c of candidates) {
    seen.add(c.key);
    const t = s.tasks[c.key];

    if (!t) {
      s.tasks[c.key] = {
        key: c.key,
        rule: c.rule,
        status: c.score >= CONFIG.showThreshold ? 'active' : 'candidate',
        score: c.score,
        url: c.url,
        urls: c.urls,
        tabId: c.tabId,
        title: c.title,
        domain: c.domain,
        visitIds: c.visitIds,
        evidence: c.evidence,
        meta: c.meta,
        lastHeading: c.lastHeading,
        ...templateLabel(c),
        createdAt: now,
        updatedAt: now,
        leftAt: c.leftAt,
        nudgeCount: 0,
      };
      continue;
    }

    if (FINISHED.has(t.status)) continue;

    Object.assign(t, {
      score: c.score,
      url: c.url,
      urls: c.urls,
      tabId: c.tabId,
      title: c.title,
      domain: c.domain,
      visitIds: c.visitIds,
      evidence: c.evidence,
      meta: c.meta,
      lastHeading: c.lastHeading,
      leftAt: c.leftAt,
      updatedAt: now,
    });
    Object.assign(t, templateLabel(c));

    // Resumed but walked away again without finishing → back on the list.
    if (t.status === 'resumed' && c.leftAt > (t.resumedAt ?? 0) + 60_000) t.status = 'active';
    if (t.status === 'candidate' || t.status === 'active') {
      t.status = c.score >= CONFIG.showThreshold ? 'active' : 'candidate';
    }
  }

  for (const t of Object.values(s.tasks)) {
    // New-message cards vanish once you've looked (or the tab closed) — no "done" history for these.
    if (t.rule === 'new_messages' && !seen.has(t.key)) {
      delete s.tasks[t.key];
      continue;
    }
    // Items from rules that no longer exist (removed in an update).
    if (!(t.rule in CONFIG.base)) {
      delete s.tasks[t.key];
      continue;
    }
    if (t.status === 'snoozed' && (t.snoozeUntil ?? 0) <= now) t.status = 'active';

    if (!FINISHED.has(t.status) && !seen.has(t.key) && looksFinished(s, t)) {
      t.status = 'done';
      t.finishedAt = now;
      t.evidence = [...t.evidence, 'Finished — detected automatically'];
    }
    // Your to-dos stay until you check them off.
    if (!FINISHED.has(t.status) && t.rule !== 'saved' && now - t.leftAt > CONFIG.taskExpireDays * DAY) {
      t.status = 'expired';
      t.finishedAt = now;
    }
    if (FINISHED.has(t.status) && now - (t.finishedAt ?? t.updatedAt) > CONFIG.pruneFinishedDays * DAY) {
      delete s.tasks[t.key];
    }
  }
}

/** Completion signals that end a task without the user clicking Done. */
function looksFinished(s: State, t: Task): boolean {
  const visits = t.visitIds.map((id) => s.visits[id]).filter(Boolean);
  if (!visits.length) return false;
  return visits.some((v) => {
    const sig = v.signals;
    if (sig.completed) return true;
    if (t.rule === 'partial_reading') return sig.scrollMax > CONFIG.reading.maxScroll;
    if (t.rule === 'partial_video') return sig.videoPct > CONFIG.video.maxPct;
    if (t.rule === 'abandoned_form' || t.rule === 'unsent_draft') return sig.submitted;
    if (t.rule === 'unsent_message') return sig.draft === 'none';
    return false;
  });
}

export const savedKey = (url: string) => `saved|${normalizeUrl(url)}`;

/** A tab you picked yourself. Saving the same page again just keeps the existing item. */
export function addSavedTask(s: State, tab: { url: string; title: string; tabId?: number }, now: number) {
  const key = savedKey(tab.url);
  const existing = s.tasks[key];
  if (existing && !FINISHED.has(existing.status)) return;
  const domain = domainOf(tab.url);
  s.tasks[key] = {
    key,
    rule: 'saved',
    status: 'active',
    score: CONFIG.base.saved,
    url: tab.url,
    urls: [tab.url],
    tabId: tab.tabId,
    title: tab.title,
    domain,
    visitIds: [],
    evidence: ['Added by you'],
    meta: {},
    ...templateLabel({ rule: 'saved', title: tab.title, domain, meta: {} }),
    createdAt: now,
    updatedAt: now,
    leftAt: now,
    nudgeCount: 0,
  };
}

export function setStatus(t: Task, status: TaskStatus, now = Date.now()) {
  t.status = status;
  t.updatedAt = now;
  if (FINISHED.has(status)) t.finishedAt = now;
}
