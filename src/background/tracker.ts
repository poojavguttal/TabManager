// Turns tab events and content-script reports into "visits" (one page view in one tab).
import { CONFIG } from '../shared/config';
import { accountOf, findApp, unreadFromTitle } from '../shared/apps';
import type { InboxEntry, PageMessage, Prefs, State, Visit } from '../shared/types';
import { domainOf, isBlocked, isTrackable, normalizeUrl } from '../shared/url';
import { classify, urlPageType } from './classifier';

const blankSignals = (): Visit['signals'] => ({
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
});

export function currentVisit(s: State, tabId: number): Visit | undefined {
  const id = s.tabVisit[tabId];
  return id ? s.visits[id] : undefined;
}

/** Returns the visit for this tab's current URL, creating one (and closing out the previous) on navigation. */
export function ensureVisit(
  s: State,
  prefs: Prefs,
  tabId: number,
  url: string | undefined,
  title?: string,
): Visit | null {
  const now = Date.now();
  const cur = currentVisit(s, tabId);

  if (!isTrackable(url) || isBlocked(url, prefs.blocklist)) {
    if (cur) leave(cur, now, true);
    delete s.tabVisit[tabId];
    return null;
  }

  const normUrl = normalizeUrl(url);
  if (cur && cur.normUrl === normUrl) {
    if (title) cur.title = title;
    cur.url = url;
    return cur;
  }

  if (cur) {
    leave(cur, now, false);
    // Submitting and then navigating away in the same tab = the form went through.
    if (cur.signals.submitted) cur.signals.completed = true;
  }

  const visit: Visit = {
    id: crypto.randomUUID(),
    tabId,
    url,
    normUrl,
    domain: domainOf(url),
    title: title || url,
    pageType: urlPageType(url) ?? 'other',
    prevVisitId: cur?.id,
    startedAt: now,
    lastActiveAt: now,
    activeSec: 0,
    lastContentSec: 0,
    closed: false,
    signals: blankSignals(),
  };
  s.visits[visit.id] = visit;
  s.tabVisit[tabId] = visit.id;
  return visit;
}

function leave(v: Visit, now: number, closed: boolean) {
  v.leftAt ??= now;
  if (closed) v.closed = true;
}

/** Merges a content-script report into the right visit. */
export function applyPageReport(s: State, prefs: Prefs, tabId: number, msg: PageMessage) {
  const now = Date.now();
  const normUrl = normalizeUrl(msg.url);
  let v = currentVisit(s, tabId);

  if (v && v.normUrl !== normUrl) {
    // A late "final flush" for the page this tab just navigated away from.
    const prev = v.prevVisitId ? s.visits[v.prevVisitId] : undefined;
    v = prev && prev.normUrl === normUrl ? prev : (ensureVisit(s, prefs, tabId, msg.url, msg.title) ?? undefined);
  } else if (!v) {
    v = ensureVisit(s, prefs, tabId, msg.url, msg.title) ?? undefined;
  }
  if (!v) return;

  // Content script counts per page load; a reload restarts its counter at 0.
  const delta = msg.activeSec >= v.lastContentSec ? msg.activeSec - v.lastContentSec : msg.activeSec;
  v.lastContentSec = msg.activeSec;
  if (delta > 0) {
    v.activeSec += delta;
    v.lastActiveAt = now;
  }
  if (msg.title) v.title = msg.title;

  const old = v.signals;
  v.signals = {
    ...msg.signals,
    scrollMax: Math.max(old.scrollMax, msg.signals.scrollMax),
    lastHeading: msg.signals.lastHeading || old.lastHeading,
    submitted: old.submitted || msg.signals.submitted,
    completed: old.completed || msg.signals.completed,
  };

  if (msg.features) {
    v.features = msg.features;
    v.pageType = classify(v.url, msg.features);
  }

  // A real "thank you" page (seen by the sensor, not inferred) completes the form you came from on the same site.
  if (msg.signals.completed && v.prevVisitId) {
    const prev = s.visits[v.prevVisitId];
    if (prev && prev.domain === v.domain) prev.signals.completed = true;
  }

  s.lastKeyAt = Math.max(s.lastKeyAt, msg.signals.lastKeyAt);
}

/** Per-tick tab facts the content script can't see: pinned state, and Chrome's last-viewed time. */
export function syncTabMeta(s: State, tabs: chrome.tabs.Tab[]) {
  for (const t of tabs) {
    if (t.id === undefined) continue;
    const v = currentVisit(s, t.id);
    if (!v) continue;
    v.pinned = !!t.pinned;
    // Tabs opened before install (or asleep since a restart) have no activity on record — use Chrome's own last-viewed time.
    if (v.activeSec === 0 && t.lastAccessed && t.lastAccessed < v.lastActiveAt) v.lastActiveAt = t.lastAccessed;
  }
}

export function onFocusTab(s: State, tabId: number | null) {
  const now = Date.now();
  if (s.focusedTabId !== null && s.focusedTabId !== tabId) {
    const prev = currentVisit(s, s.focusedTabId);
    if (prev) prev.leftAt = now;
  }
  s.focusedTabId = tabId;
  if (tabId !== null && s.windowFocused) {
    const v = currentVisit(s, tabId);
    if (v) {
      v.leftAt = undefined;
      v.lastActiveAt = now;
    }
  }
}

export function onWindowFocus(s: State, focused: boolean) {
  const now = Date.now();
  s.windowFocused = focused;
  const v = s.focusedTabId !== null ? currentVisit(s, s.focusedTabId) : undefined;
  if (!v) return;
  if (focused) {
    v.leftAt = undefined;
    v.lastActiveAt = now;
  } else {
    v.leftAt = now;
  }
}

export function onTabClosed(s: State, tabId: number) {
  const v = currentVisit(s, tabId);
  if (v) leave(v, Date.now(), true);
  delete s.tabVisit[tabId];
  delete s.pendingScroll[tabId];
  delete s.inbox[tabId];
  if (s.focusedTabId === tabId) s.focusedTabId = null;
}

/**
 * Tracks unread counts of open messaging/email tabs from their titles only (no page access,
 * so it works even for sites on the blocklist). The first count seen is the baseline, so an
 * inbox that already had 2,000 unread doesn't show up — only messages that arrive later.
 */
export function syncInbox(s: State, tabs: chrome.tabs.Tab[], enabled: boolean, now: number) {
  const next: Record<number, InboxEntry> = {};
  if (enabled) {
    for (const t of tabs) {
      if (t.id === undefined || !t.url) continue;
      const app = findApp(t.url);
      if (!app) continue;
      const prev = s.inbox[t.id]?.appId === app.id ? s.inbox[t.id] : undefined;
      const viewing = s.windowFocused && s.focusedTabId === t.id;
      const parsed = unreadFromTitle(t.title ?? '');
      // No count in the title: chat apps drop it when nothing is unread (→ 0); email apps also drop it
      // while you read a message (Gmail shows the subject), so there it means "unknown" → keep what we had.
      const unknown = parsed === null && app.kind === 'email';
      const count = parsed ?? (unknown ? (prev?.count ?? 0) : 0);
      let seen = prev ? prev.seen : count;
      if ((viewing && !unknown) || count < seen) seen = count;
      // Gmail's title loses nothing account-wise, but keep the last known account if this title has none.
      const account = accountOf(t.url, t.title ?? '') || prev?.account || '';
      next[t.id] = { tabId: t.id, appId: app.id, account, url: t.url, count, seen, newSince: count > seen ? (prev?.newSince ?? now) : undefined };
    }
  }
  // Looking at any tab of an account counts as having seen that account everywhere.
  const viewedGroups = new Set(
    Object.values(next)
      .filter((e) => s.windowFocused && s.focusedTabId === e.tabId)
      .map(inboxGroup),
  );
  for (const e of Object.values(next)) {
    if (viewedGroups.has(inboxGroup(e))) {
      e.seen = e.count;
      e.newSince = undefined;
    }
  }
  s.inbox = next;
}

export const inboxGroup = (e: InboxEntry) => `${e.appId}|${e.account}`;

/** "Mark as read" from the panel: everything currently unread in that account counts as seen. */
export function markInboxSeen(s: State, group: string) {
  for (const e of Object.values(s.inbox)) {
    if (inboxGroup(e) === group) {
      e.seen = e.count;
      e.newSince = undefined;
    }
  }
}

export function pruneVisits(s: State) {
  const cutoff = Date.now() - CONFIG.visitRetentionDays * 86_400_000;
  const live = new Set(Object.values(s.tabVisit));
  let visits = Object.values(s.visits).filter((v) => live.has(v.id) || v.startedAt > cutoff);
  if (visits.length > CONFIG.maxVisits) {
    visits = visits.sort((a, b) => b.startedAt - a.startedAt).filter((v, i) => i < CONFIG.maxVisits || live.has(v.id));
  }
  s.visits = Object.fromEntries(visits.map((v) => [v.id, v]));
}
