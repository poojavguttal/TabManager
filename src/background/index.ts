// Background service worker: wires Chrome events to the tracker → rules → lifecycle → nudges pipeline.
import { CONFIG, emptyState } from '../shared/config';
import type { NotifAction, PageMessage, PanelMessage, Prefs } from '../shared/types';
import { isBlocked, isTrackable, normalizeUrl } from '../shared/url';
import { addSavedTask, isPending, isShown, merge, setStatus } from './lifecycle';
import { deliver, pickNudge, type Nudge } from './nudges';
import { evaluate } from './rules';
import { loadPrefs, loadState, savePrefs, update } from './storage';
import {
  applyPageReport,
  ensureVisit,
  markInboxSeen,
  onFocusTab,
  onTabClosed,
  onWindowFocus,
  pruneVisits,
  syncInbox,
  syncTabMeta,
} from './tracker';

const MIN = 60_000;
let lastFocusedWindowId: number | undefined;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await setup();
  chrome.contextMenus.create({ id: SAVE_MENU_ID, title: 'Add to Tab Resume', contexts: ['page'] }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create(
    { id: MOVE_MENU_ID, title: 'Move to Tab Resume (closes the tab)', contexts: ['page'] },
    () => void chrome.runtime.lastError,
  );
  chrome.contextMenus.create({ id: LINK_MENU_ID, title: 'Add link to Tab Resume', contexts: ['link'] }, () => void chrome.runtime.lastError);
  await scanTabs(false);
  // An install/reload orphans copies already running in open tabs; refresh them if access is granted.
  if (await chrome.permissions.contains(ALL_SITES)) await injectIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await setup();
  await scanTabs(true);
});

// ---------------------------------------------------------------------------
// Page sensor: off until you grant site access (optional permission), so installing asks for no site access.
// Without it, "Still open" tabs and new messages still work — they only use tab titles and URLs.
// ---------------------------------------------------------------------------

const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };
const SENSOR_ID = 'sensor';

async function syncSensor() {
  const granted = await chrome.permissions.contains(ALL_SITES);
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SENSOR_ID] })).length > 0;
  if (granted && !registered) {
    await chrome.scripting.registerContentScripts([
      { id: SENSOR_ID, matches: ['http://*/*', 'https://*/*'], js: ['content.js'], runAt: 'document_idle' },
    ]);
    await injectIntoOpenTabs();
  } else if (!granted && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [SENSOR_ID] });
  }
}

chrome.permissions.onAdded.addListener(() => void syncSensor());
chrome.permissions.onRemoved.addListener(() => void syncSensor());

async function setup() {
  await syncSensor();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.alarms.create('tick', { periodInMinutes: 1 });
  chrome.idle.setDetectionInterval(60);
  await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
}

/** Tab IDs don't survive a browser restart, so old mappings are closed out and rebuilt. */
async function scanTabs(browserRestarted: boolean) {
  const prefs = await loadPrefs();
  const tabs = await chrome.tabs.query({});
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await update((s) => {
    if (browserRestarted) {
      for (const id of Object.values(s.tabVisit)) {
        const v = s.visits[id];
        if (v) {
          v.closed = true;
          v.leftAt ??= Date.now();
        }
      }
      s.tabVisit = {};
    }
    for (const t of tabs) if (t.id !== undefined) ensureVisit(s, prefs, t.id, t.url, t.title);
    s.focusedTabId = active?.id ?? null;
  });
}

/** Content scripts aren't injected into tabs that were open before install. */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(
    tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id! }, files: ['content.js'] }).catch(() => {})),
  );
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick') void tick();
});

// ---------------------------------------------------------------------------
// Tab / window / idle events
// ---------------------------------------------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url && !info.title && info.status !== 'complete') return;
  const prefs = await loadPrefs();
  const heading = await update((s) => {
    ensureVisit(s, prefs, tabId, tab.url, tab.title);
    if (info.status !== 'complete' || !s.pendingScroll[tabId]) return undefined;
    const h = s.pendingScroll[tabId];
    delete s.pendingScroll[tabId];
    return h;
  });
  if (heading) setTimeout(() => chrome.tabs.sendMessage(tabId, { type: 'scrollToHeading', heading }).catch(() => {}), 800);
  scheduleTick();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await update((s) => onFocusTab(s, tabId));
  scheduleTick();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await update((s) => onTabClosed(s, tabId));
  // Closed because you just saved it — no "you closed something unfinished" reminder for that.
  const savedAndClosed = closingAfterSave.delete(tabId);
  await tick(savedAndClosed ? {} : { closedTabId: tabId });
});

chrome.tabs.onReplaced.addListener(async (added, removed) => {
  await update((s) => {
    const id = s.tabVisit[removed];
    if (!id) return;
    s.tabVisit[added] = id;
    delete s.tabVisit[removed];
    if (s.visits[id]) s.visits[id].tabId = added;
    if (s.focusedTabId === removed) s.focusedTabId = added;
  });
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const focused = windowId !== chrome.windows.WINDOW_ID_NONE;
  if (focused) lastFocusedWindowId = windowId;
  const [active] = focused ? await chrome.tabs.query({ active: true, windowId }) : [];
  await update((s) => {
    onWindowFocus(s, focused);
    if (active?.id !== undefined) onFocusTab(s, active.id);
  });
  scheduleTick();
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state !== 'active') {
    await update((s) => {
      s.idleSince ??= Date.now();
    });
    return;
  }
  const idleSince = await update((s) => {
    const since = s.idleSince;
    s.idleSince = null;
    return since;
  });
  const welcomeBack = idleSince !== null && Date.now() - idleSince >= CONFIG.nudge.welcomeBackIdleMin * MIN;
  await tick({ welcomeBack });
});

// ---------------------------------------------------------------------------
// The pipeline: evaluate rules → merge into tasks → maybe nudge
// ---------------------------------------------------------------------------

let tickTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleTick() {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(() => void tick(), 1500);
}

interface TickContext {
  closedTabId?: number;
  welcomeBack?: boolean;
}

async function tick(ctx: TickContext = {}) {
  const prefs = await loadPrefs();
  const now = Date.now();
  const [idle, win, tabs] = await Promise.all([
    chrome.idle.queryState(60),
    chrome.windows.getLastFocused().catch(() => undefined),
    chrome.tabs.query({}),
  ]);

  const { nudge, focusedTabId } = await update((s) => {
    syncTabMeta(s, tabs);
    syncInbox(s, tabs, prefs.watchMessages, now);
    merge(s, evaluate(s, now), now);
    pruneVisits(s);
    const nudge = pickNudge(s, prefs, now, {
      closedTabId: ctx.closedTabId,
      welcomeBack: ctx.welcomeBack,
      userActive: idle === 'active',
      fullscreen: win?.state === 'fullscreen',
    });
    return { nudge, focusedTabId: s.focusedTabId };
  });

  await updateBadge();
  if (nudge) await deliver(nudge, prefs, focusedTabId).catch((e) => console.warn('[tab-resume] nudge failed', e));
}

async function updateBadge() {
  const s = await loadState();
  const n = Object.values(s.tasks).filter(isPending).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

// ---------------------------------------------------------------------------
// Task actions (from the side panel, notifications and in-page toasts)
// ---------------------------------------------------------------------------

async function resumeTask(key: string) {
  const task = await update((s) => {
    const t = s.tasks[key];
    if (!t) return null;
    setStatus(t, 'resumed');
    t.resumedAt = Date.now();
    return { ...t };
  });
  if (!task) return;
  const heading = task.rule === 'partial_reading' ? task.lastHeading : undefined;
  const want = normalizeUrl(task.url);

  // Prefer the original tab, then any open tab on that URL, then a new tab.
  let tab = task.tabId !== undefined ? await chrome.tabs.get(task.tabId).catch(() => undefined) : undefined;
  if (tab && normalizeUrl(tab.url ?? '') !== want) tab = undefined;
  tab ??= (await chrome.tabs.query({})).find((t) => normalizeUrl(t.url ?? '') === want);

  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    if (heading) chrome.tabs.sendMessage(tab.id, { type: 'scrollToHeading', heading }).catch(() => {});
  } else {
    const created = await chrome.tabs.create({ url: task.url });
    if (heading && created.id !== undefined) {
      await update((s) => {
        s.pendingScroll[created.id!] = heading;
      });
    }
  }
  await updateBadge();
}

async function taskAction(action: 'done' | 'dismiss' | 'snooze' | 'restore', key: string, minutes = CONFIG.nudge.snoozeMin) {
  await update((s) => {
    const t = s.tasks[key];
    if (!t) return;
    // Checking off a new-messages card = "mark as read" for that account.
    if (t.rule === 'new_messages' && (action === 'done' || action === 'dismiss')) {
      markInboxSeen(s, key.slice('new_messages|'.length));
      delete s.tasks[key];
      return;
    }
    if (action === 'restore') {
      if (t.status === 'dismissed') {
        const k = `${t.domain}|${t.rule}`;
        s.suppressed[k] = Math.max(0, (s.suppressed[k] ?? 1) - 1);
      }
      setStatus(t, 'active');
      t.finishedAt = undefined;
      t.snoozeUntil = undefined;
      return;
    }
    if (action === 'done') setStatus(t, 'done');
    if (action === 'dismiss') {
      setStatus(t, 'dismissed');
      // Learn from dismissed suggestions — but removing something you saved yourself isn't feedback.
      if (t.rule !== 'saved') {
        const k = `${t.domain}|${t.rule}`;
        s.suppressed[k] = (s.suppressed[k] ?? 0) + 1;
      }
    }
    if (action === 'snooze') {
      setStatus(t, 'snoozed');
      t.snoozeUntil = Date.now() + minutes * MIN;
    }
  });
  await updateBadge();
}

async function openPanel(): Promise<boolean> {
  try {
    const windowId = lastFocusedWindowId ?? (await chrome.windows.getLastFocused()).id!;
    await chrome.sidePanel.open({ windowId });
    return true;
  } catch {
    return false; // Chrome only allows this during a user gesture.
  }
}

async function handleNotifAction(id: string, index: number) {
  chrome.notifications.clear(id).catch(() => {});
  // Try to open the panel first, while we're still inside the click's user gesture.
  const isWelcomeList = id.startsWith('nudge|welcome|') && index === 1;
  const opened = isWelcomeList ? await openPanel() : false;

  const s = await loadState();
  const ref = s.notifs[id];
  if (!ref?.key) return;
  const action: NotifAction | undefined = index < 0 ? ref.actions[0] : ref.actions[index];
  if (action === 'resume' || (action === 'openPanel' && !opened)) await resumeTask(ref.key);
  else if (action === 'snooze' || action === 'dismiss') await taskAction(action, ref.key);
}

chrome.notifications.onButtonClicked.addListener((id, index) => void handleNotifAction(id, index));
chrome.notifications.onClicked.addListener((id) => void handleNotifAction(id, -1));

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type IncomingMessage = PageMessage | PanelMessage | { type: 'notifAction'; id: string; index: number };

chrome.runtime.onMessage.addListener((msg: IncomingMessage, sender, sendResponse) => {
  void handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[tab-resume]', err);
      sendResponse({ error: String(err) });
    });
  return true; // async response
});

async function handleMessage(msg: IncomingMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'page': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const prefs = await loadPrefs();
      await update((s) => applyPageReport(s, prefs, tabId, msg));
      scheduleTick();
      return;
    }
    case 'notifAction':
      return handleNotifAction(msg.id, msg.index);
    case 'action':
      if (msg.action === 'resume') return resumeTask(msg.key);
      return taskAction(msg.action, msg.key, msg.minutes);
    case 'setPrefs': {
      const prefs = await savePrefs(msg.prefs);
      if (msg.prefs.blocklist) await purgeBlocked(prefs);
      return tick();
    }
    case 'pauseNudges':
      await savePrefs({ pausedUntil: msg.minutes > 0 ? Date.now() + msg.minutes * MIN : 0 });
      return;
    case 'refresh':
      return tick();
    case 'saveTabs':
      return saveTabs(msg.tabIds, msg.close);
    case 'saveUrl':
      return saveUrl(msg.url, msg.title, msg.close);
    case 'testNudge':
      return testNudge();
    case 'clearAll':
      await update((s) => {
        Object.assign(s, emptyState());
      });
      await scanTabs(false);
      await updateBadge();
      return;
  }
}

// ---------------------------------------------------------------------------
// Your own to-dos: panel picker, drag and drop, right-click menu, keyboard shortcut
// ---------------------------------------------------------------------------

const SAVE_MENU_ID = 'save-page';
const MOVE_MENU_ID = 'move-page';
const LINK_MENU_ID = 'save-link';
const closingAfterSave = new Set<number>();

/** Returns the title of what was added, for the panel's confirmation. */
async function saveTabs(tabIds: number[], close: boolean): Promise<string | undefined> {
  const tabs = (await Promise.all(tabIds.map((id) => chrome.tabs.get(id).catch(() => undefined)))).filter(
    (t): t is chrome.tabs.Tab => !!t && t.id !== undefined && isTrackable(t.url),
  );
  if (!tabs.length) return undefined;
  const now = Date.now();
  await update((s) => {
    for (const t of tabs) addSavedTask(s, { url: t.url!, title: t.title || t.url!, tabId: t.id }, now);
  });
  if (close) {
    for (const t of tabs) closingAfterSave.add(t.id!);
    await chrome.tabs.remove(tabs.map((t) => t.id!)).catch(() => {});
  }
  await tick();
  return tabs[0].title || tabs[0].url;
}

/** A URL rather than a tab: if that page is open, it's the same as adding the tab; otherwise it's just saved. */
async function saveUrl(url: string, title: string | undefined, close: boolean): Promise<string | undefined> {
  if (!isTrackable(url)) return undefined;
  const want = normalizeUrl(url);
  const open = (await chrome.tabs.query({})).filter((t) => t.id !== undefined && t.url && normalizeUrl(t.url) === want);
  if (open.length) return saveTabs(open.map((t) => t.id!), close);
  const label = title?.trim() || prettyUrl(url);
  await update((s) => addSavedTask(s, { url, title: label }, Date.now()));
  await tick();
  return label;
}

function prettyUrl(url: string): string {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname).replace(/\/$/, '');
  return `${u.hostname.replace(/^www\./, '')}${path.length > 1 ? path : ''}`;
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SAVE_MENU_ID && tab?.id !== undefined) void saveTabs([tab.id], false);
  if (info.menuItemId === MOVE_MENU_ID && tab?.id !== undefined) void saveTabs([tab.id], true);
  if (info.menuItemId === LINK_MENU_ID && info.linkUrl) void saveUrl(info.linkUrl, info.selectionText, false);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-tab') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id !== undefined) await saveTabs([tab.id], false);
});

/** Removes everything we stored about sites that were just added to the blocklist. */
async function purgeBlocked(prefs: Prefs) {
  await update((s) => {
    for (const v of Object.values(s.visits)) {
      if (!isTrackable(v.url) || !isBlocked(v.url, prefs.blocklist)) continue;
      delete s.visits[v.id];
      if (s.tabVisit[v.tabId] === v.id) delete s.tabVisit[v.tabId];
    }
    for (const t of Object.values(s.tasks)) if (isBlocked(t.url, prefs.blocklist)) delete s.tasks[t.key];
  });
}

/** Sends a nudge right now (ignoring guardrails) so you can check notification permissions / demo. */
async function testNudge() {
  const prefs = await loadPrefs();
  const now = Date.now();
  const { nudge, focusedTabId } = await update((s) => {
    const top = Object.values(s.tasks)
      .filter(isShown)
      .sort((a, b) => b.score - a.score)[0];
    const id = `nudge|task|${now}`;
    const nudge: Nudge = top
      ? {
          id,
          title: top.label,
          message: top.note,
          buttons: ['Resume', 'Snooze 1h'],
          ref: { kind: 'task', key: top.key, actions: ['resume', 'snooze'], at: now },
        }
      : {
          id,
          title: 'Tab Resume is working',
          message: 'No unfinished tasks yet — this is what a nudge looks like.',
          buttons: [],
          ref: { kind: 'task', actions: [], at: now },
        };
    s.notifs[id] = nudge.ref;
    return { nudge, focusedTabId: s.focusedTabId };
  });
  await deliver(nudge, prefs, focusedTabId);
}


