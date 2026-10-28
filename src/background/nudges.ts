// Decides IF and WHAT to nudge (inside a state update), then delivers it.
import { CONFIG } from '../shared/config';
import type { NotifAction, NotifRef, Prefs, State, Task } from '../shared/types';
import { isPending } from './lifecycle';

const MIN = 60_000;

export interface Nudge {
  id: string;
  title: string;
  message: string;
  buttons: string[];
  ref: NotifRef;
}

export interface NudgeContext {
  closedTabId?: number;
  welcomeBack?: boolean;
  userActive: boolean;
  fullscreen: boolean;
}

export function nudgesAllowed(prefs: Prefs, now: number): boolean {
  if (!prefs.nudgesEnabled || prefs.pausedUntil > now) return false;
  const { quietStart: a, quietEnd: b } = prefs;
  if (a === null || b === null || a === b) return true;
  const h = new Date(now).getHours();
  const quiet = a < b ? h >= a && h < b : h >= a || h < b;
  return !quiet;
}

export function pickNudge(s: State, prefs: Prefs, now: number, ctx: NudgeContext): Nudge | null {
  if (!nudgesAllowed(prefs, now)) return null;
  const n = CONFIG.nudge;
  const sinceLast = now - s.lastNudgeAt;
  const underCap = (t: Task) => t.nudgeCount < n.maxPerTask;

  // 1) Closing nudge: you just closed a tab with unfinished work in it.
  if (ctx.closedTabId !== undefined && sinceLast >= n.closingGapMin * MIN) {
    const closedVisitIds = new Set(
      Object.values(s.visits)
        .filter((v) => v.tabId === ctx.closedTabId && v.closed)
        .map((v) => v.id),
    );
    const task = best(
      Object.values(s.tasks).filter(
        (t) => isPending(t) && t.score >= CONFIG.nudgeThreshold && underCap(t) && t.visitIds.some((id) => closedVisitIds.has(id)),
      ),
    );
    if (task) {
      return commit(s, now, task, {
        title: `Saved for later: ${task.label}`,
        message: task.note,
        buttons: ['Reopen', 'Not needed'],
        actions: ['resume', 'dismiss'],
      });
    }
  }

  // 2) Welcome back after being away from the computer.
  if (ctx.welcomeBack && sinceLast >= n.globalGapMin * MIN) {
    const pending = Object.values(s.tasks).filter(isPending);
    const top = best(pending);
    if (top) {
      const id = `nudge|welcome|${now}`;
      const ref: NotifRef = { kind: 'welcome', key: top.key, actions: ['resume', 'openPanel'], at: now };
      record(s, now, id, ref);
      return {
        id,
        title: 'Welcome back',
        message: `You left ${pending.length} thing${pending.length === 1 ? '' : 's'} open, like: ${top.label}`,
        buttons: ['Resume top task', 'Show list'],
        ref,
      };
    }
  }

  // 3) Stale task nudge — only when you're active, not typing, not watching fullscreen.
  if (!ctx.userActive || ctx.fullscreen) return null;
  if (now - s.lastKeyAt < n.typingQuietSec * 1000) return null;
  if (sinceLast < n.globalGapMin * MIN) return null;
  const task = best(
    Object.values(s.tasks).filter(
      (t) =>
        isPending(t) &&
        t.score >= CONFIG.nudgeThreshold &&
        underCap(t) &&
        now - (t.lastNudgedAt ?? 0) >= n.perTaskGapMin * MIN &&
        now - t.leftAt >= n.staleAwayMin * MIN &&
        !(t.tabId !== undefined && t.tabId === s.focusedTabId && s.windowFocused),
    ),
  );
  if (!task) return null;
  return commit(s, now, task, {
    title: task.label,
    message: task.note,
    buttons: ['Resume', 'Snooze 1h'],
    actions: ['resume', 'snooze'],
  });
}

function best(tasks: Task[]): Task | undefined {
  return tasks.sort((a, b) => b.score - a.score)[0];
}

function commit(
  s: State,
  now: number,
  task: Task,
  n: { title: string; message: string; buttons: string[]; actions: NotifAction[] },
): Nudge {
  task.nudgeCount++;
  task.lastNudgedAt = now;
  task.status = 'nudged';
  const id = `nudge|task|${now}`;
  const ref: NotifRef = { kind: 'task', key: task.key, actions: n.actions, at: now };
  record(s, now, id, ref);
  return { id, title: n.title, message: n.message, buttons: n.buttons, ref };
}

function record(s: State, now: number, id: string, ref: NotifRef) {
  s.lastNudgeAt = now;
  s.notifs[id] = ref;
  const ids = Object.keys(s.notifs).sort((a, b) => s.notifs[b].at - s.notifs[a].at);
  for (const old of ids.slice(20)) delete s.notifs[old];
}

/** In-page toast if enabled and the page has our content script; system notification otherwise. */
export async function deliver(nudge: Nudge, prefs: Prefs, focusedTabId: number | null) {
  if (prefs.inPageToast && focusedTabId !== null) {
    try {
      await chrome.tabs.sendMessage(focusedTabId, {
        type: 'toast',
        toast: { id: nudge.id, title: nudge.title, message: nudge.message, buttons: nudge.buttons },
      });
      return;
    } catch {
      // No content script on this page (chrome://, store, blocked site) — fall through.
    }
  }
  await chrome.notifications.create(nudge.id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title: nudge.title,
    message: nudge.message,
    buttons: nudge.buttons.map((title) => ({ title })),
    priority: 1,
  });
}
