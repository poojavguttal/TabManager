import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IGNORED_TYPES, urlPageType } from '../background/classifier';
import { isShown } from '../background/lifecycle';
import { findApp } from '../shared/apps';
import { CONFIG, DEFAULT_PREFS, RULE_ICONS, emptyState } from '../shared/config';
import type { PanelMessage, Prefs, State, Task } from '../shared/types';
import { normalizeUrl } from '../shared/url';
import {
  BackIcon,
  BellIcon,
  BellOffIcon,
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  GearIcon,
  Logo,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  XIcon,
} from './icons';

const send = <T = unknown,>(msg: PanelMessage) => chrome.runtime.sendMessage(msg) as Promise<T>;
const MESSAGE_RULES = new Set<Task['rule']>(['unsent_message', 'new_messages']);
/** How long the check-off animation plays before the item is actually marked done. */
const COMPLETE_MS = 650;
const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };
const CLOSE_AFTER_KEY = 'closeAfterAdding';

/** Per-viewer convenience only; the panel works fine if storage is unavailable. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore
  }
}

/** A link, or a page dragged by its address-bar icon. */
function readDrop(dt: DataTransfer): { url?: string; title?: string } {
  const uri = dt
    .getData('text/uri-list')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  const url = [uri, dt.getData('text/plain').trim()].find((u) => u && /^https?:\/\//.test(u));
  const html = dt.getData('text/html');
  let title = html ? new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() : undefined;
  if (!title || title === url) title = undefined;
  return { url, title };
}

const looksDroppable = (dt: DataTransfer | null) => !!dt && (dt.types.includes('text/uri-list') || dt.types.includes('text/plain'));

/** Lets you drag a page (address-bar icon) or a link onto the panel to add it — and close its tab. */
function useDropToAdd(onAdded: (title: string) => void) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0; // dragenter/leave fire for every child element; count to know when we really left
    const enter = (e: DragEvent) => {
      if (!looksDroppable(e.dataTransfer)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!looksDroppable(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const { url, title } = readDrop(e.dataTransfer!);
      if (!url) return;
      void send<string | undefined>({ type: 'saveUrl', url, title, close: true }).then((added) =>
        onAdded(added ?? title ?? new URL(url).hostname.replace(/^www\./, '')),
      );
    };
    addEventListener('dragenter', enter);
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragover', over);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', drop);
    };
  }, [onAdded]);
  return dragging;
}

function useStore() {
  const [state, setState] = useState<State>(emptyState());
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    chrome.storage.local.get(['state', 'prefs']).then((r) => {
      if (r.state) setState({ ...emptyState(), ...r.state });
      if (r.prefs) setPrefs({ ...DEFAULT_PREFS, ...r.prefs });
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes.state?.newValue) setState({ ...emptyState(), ...changes.state.newValue });
      if (changes.prefs?.newValue) setPrefs({ ...DEFAULT_PREFS, ...changes.prefs.newValue });
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return { state, prefs };
}

/** Whether the page sensor has site access (an optional permission the user grants from the panel). */
function useSiteAccess() {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => void chrome.permissions.contains(ALL_SITES).then(setGranted);
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, []);
  // Must run directly inside a click handler: Chrome only shows the prompt during a user gesture.
  const request = useCallback(() => void chrome.permissions.request(ALL_SITES), []);
  const revoke = useCallback(() => void chrome.permissions.remove(ALL_SITES), []);
  return { granted, request, revoke };
}

/** All open web tabs, live: this tab first, then most recently viewed. Read straight from Chrome, so it's never stale. */
function useOpenTabs() {
  const [openTabs, setOpenTabs] = useState<chrome.tabs.Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const [all, win] = await Promise.all([chrome.tabs.query({}), chrome.windows.getLastFocused()]);
      const web = all.filter((t) => t.id !== undefined && /^https?:\/\//.test(t.url ?? ''));
      const active = web.find((t) => t.active && t.windowId === win.id);
      web.sort((a, b) => Number(b.id === active?.id) - Number(a.id === active?.id) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      setOpenTabs(web);
      setActiveTabId(active?.id);
    };
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 150);
    };
    void load();
    const events = [
      chrome.tabs.onCreated,
      chrome.tabs.onRemoved,
      chrome.tabs.onUpdated,
      chrome.tabs.onActivated,
      chrome.tabs.onReplaced,
      chrome.windows.onFocusChanged,
    ] as chrome.events.Event<() => void>[];
    for (const e of events) e.addListener(refresh);
    return () => {
      clearTimeout(timer);
      for (const e of events) e.removeListener(refresh);
    };
  }, []);
  return { tabs: openTabs, currentTabId: activeTabId };
}

const isSavedStatus = (t: Task) => t.rule === 'saved' && (t.status === 'active' || t.status === 'nudged' || t.status === 'snoozed');

function useSavedUrls(state: State) {
  return useMemo(() => new Set(Object.values(state.tasks).filter(isSavedStatus).map((t) => normalizeUrl(t.url))), [state.tasks]);
}

/**
 * "Open tabs": tabs you haven't been back to in an hour — not your current tab, pinned tabs, searches, feeds, logins,
 * messaging apps, or pages already on your to-do list. One row per page, even if it's open in several tabs.
 */
function forgottenTabs(tabs: chrome.tabs.Tab[], state: State, savedUrls: Set<string>, currentTabId: number | undefined, now: number) {
  const seen = new Set<string>();
  return tabs.filter((t) => {
    if (t.id === currentTabId || t.pinned || !t.lastAccessed) return false;
    if (now - t.lastAccessed < CONFIG.openTabs.inactiveMin * 60_000) return false;
    const url = t.url!;
    const norm = normalizeUrl(url);
    if (seen.has(norm) || savedUrls.has(norm) || findApp(url)) return false;
    const visitId = state.tabVisit[t.id!];
    const pageType = (visitId && state.visits[visitId]?.pageType) || urlPageType(url);
    if (pageType && IGNORED_TYPES.has(pageType)) return false;
    seen.add(norm);
    return true;
  });
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function ago(ts: number, now: number) {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

const clockTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const favicon = (url: string) => `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function App() {
  const { state, prefs } = useStore();
  const access = useSiteAccess();
  const [view, setView] = useState<'list' | 'settings' | 'add'>('list');

  useEffect(() => {
    void send({ type: 'refresh' });
  }, []);

  return (
    <div className="app">
      {view === 'list' && (
        <ListView state={state} prefs={prefs} access={access} onSettings={() => setView('settings')} onAdd={() => setView('add')} />
      )}
      {view === 'add' && <AddView state={state} onBack={() => setView('list')} />}
      {view === 'settings' && <SettingsView state={state} prefs={prefs} access={access} onBack={() => setView('list')} />}
    </div>
  );
}

type Access = ReturnType<typeof useSiteAccess>;

// ---------------------------------------------------------------------------
// To-do list
// ---------------------------------------------------------------------------

function ListView({
  state,
  prefs,
  access,
  onSettings,
  onAdd,
}: {
  state: State;
  prefs: Prefs;
  access: Access;
  onSettings: () => void;
  onAdd: () => void;
}) {
  const now = useNow();
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'list' | 'open'>('list');
  const [undo, setUndo] = useState<{ key: string; label: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const onDropped = useCallback((title: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(`Added to your to-do list: ${title}`);
    noticeTimer.current = setTimeout(() => setNotice(null), 3500);
  }, []);
  const dragging = useDropToAdd(onDropped);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const openTabs = useOpenTabs();
  const savedUrls = useSavedUrls(state);
  const forgotten = forgottenTabs(openTabs.tabs, state, savedUrls, openTabs.currentTabId, now);

  const tasks = Object.values(state.tasks);
  const open = tasks.filter((t) => isShown(t) && t.status !== 'snoozed').sort((a, b) => b.score - a.score || b.leftAt - a.leftAt);
  const messages = open.filter((t) => MESSAGE_RULES.has(t.rule));
  const saved = open.filter((t) => t.rule === 'saved').sort((a, b) => b.createdAt - a.createdAt);
  const work = open.filter((t) => !MESSAGE_RULES.has(t.rule) && t.rule !== 'saved');
  const snoozed = tasks.filter((t) => t.status === 'snoozed');
  const done = tasks
    .filter((t) => t.status === 'done' && now - (t.finishedAt ?? 0) < 86_400_000 && !completing.has(t.key))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const paused = prefs.pausedUntil > now;
  const count = messages.length + saved.length + work.length;

  const summary = [
    messages.length ? plural(messages.length, 'message') : '',
    saved.length ? plural(saved.length, 'to-do') : '',
    work.length ? `${work.length} to finish` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const complete = (t: Task) => {
    setCompleting((s) => new Set(s).add(t.key));
    setTimeout(async () => {
      await send({ type: 'action', action: 'done', key: t.key });
      setCompleting((s) => {
        const n = new Set(s);
        n.delete(t.key);
        return n;
      });
      // New-message cards are "mark as read" — nothing to undo.
      if (t.rule !== 'new_messages') {
        clearTimeout(undoTimer.current);
        setUndo({ key: t.key, label: t.label });
        undoTimer.current = setTimeout(() => setUndo(null), 5000);
      }
    }, COMPLETE_MS);
  };

  const rowProps = { now, completing, onComplete: complete };

  return (
    <>
      <TopBar>
        <div className="brand">
          <Logo size={26} />
          <span>Tab Resume</span>
        </div>
        <div className="top-actions">
          <button className="add-btn" onClick={onAdd} title="Pick a tab to add to your list">
            <PlusIcon width={15} height={15} /> Add
          </button>
          <button
            className="icon-btn"
            onClick={() => send({ type: 'pauseNudges', minutes: paused ? 0 : 60 })}
            title={paused ? 'Turn reminders back on' : 'Pause reminders for 1 hour'}
            aria-label={paused ? 'Turn reminders back on' : 'Pause reminders for 1 hour'}
          >
            {paused ? <BellOffIcon /> : <BellIcon />}
          </button>
          <button className="icon-btn" onClick={onSettings} title="Settings" aria-label="Settings">
            <GearIcon />
          </button>
        </div>
      </TopBar>

      <main className="content">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>
            My list{count ? <span className="tab-count">{count}</span> : null}
          </button>
          <button role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
            Open tabs{forgotten.length ? <span className="tab-count">{forgotten.length}</span> : null}
          </button>
        </div>

        {tab === 'list' && (
          <>
            <section className="summary">
              <p className="summary-eyebrow">{greeting(now)}</p>
              <h1>{count ? `${plural(count, 'thing')} left behind` : 'All caught up'}</h1>
              <p className="summary-sub">{summary || 'Nothing unfinished right now'}</p>
              {paused && (
                <button className="summary-chip" onClick={() => send({ type: 'pauseNudges', minutes: 0 })}>
                  <BellOffIcon width={13} height={13} /> Reminders paused until {clockTime(prefs.pausedUntil)} · Resume
                </button>
              )}
            </section>

            {access.granted === false && (
              <section className="callout">
                <div>
                  <p className="callout-title">Catch unfinished forms and drafts</p>
                  <p className="callout-text">
                    Lets Tab Resume notice a half-filled form, a doc you stopped reading, or a message you didn't send. It never reads what
                    you type, and nothing leaves this computer.
                  </p>
                </div>
                <button className="btn-primary" onClick={access.request}>
                  Turn on
                </button>
              </section>
            )}

            {count === 0 && (
              <div className="empty">
                <Logo size={44} />
                <p className="empty-title">Nothing left hanging</p>
                <p className="empty-text">Anything you leave halfway will show up here — or add your own tabs to the to-do list.</p>
              </div>
            )}

            {messages.length > 0 && (
              <Section title="Messages">
                {messages.map((t) => (
                  <Row key={t.key} task={t} {...rowProps} />
                ))}
              </Section>
            )}

            <Section title="To do">
              {saved.map((t) => (
                <Row key={t.key} task={t} {...rowProps} />
              ))}
              <li className="drop-row">
                <button onClick={onAdd}>
                  <PlusIcon width={14} height={14} /> Drop a tab or link here, or pick tabs
                </button>
              </li>
            </Section>

            {work.length > 0 && (
              <Section title="Pick up where you left off">
                {work.map((t) => (
                  <Row key={t.key} task={t} {...rowProps} />
                ))}
              </Section>
            )}

            {snoozed.length > 0 && (
              <Collapsible title={`Later · ${snoozed.length}`}>
                {snoozed.map((t) => (
                  <Row key={t.key} task={t} {...rowProps} />
                ))}
              </Collapsible>
            )}

            {done.length > 0 && (
              <Collapsible title={`Completed today · ${done.length}`}>
                {done.map((t) => (
                  <li key={t.key} className="row is-done">
                    <button
                      className="check checked"
                      aria-label="Mark as not done"
                      onClick={() => send({ type: 'action', action: 'restore', key: t.key })}
                    >
                      <CheckIcon width={12} height={12} />
                    </button>
                    <span className="row-main static">
                      <Favicon task={t} />
                      <span className="txt">
                        <span className="title">{t.label}</span>
                      </span>
                    </span>
                  </li>
                ))}
              </Collapsible>
            )}
          </>
        )}

        {tab === 'open' && (
          <>
            <p className="tab-hint">Tabs you haven't been back to in over an hour. Click one to go to it, + to move it to your to-do list, × to close it.</p>
            {forgotten.length ? (
              <ul className="list">
                {forgotten.map((t) => (
                  <OpenTabRow key={t.id} tab={t} now={now} />
                ))}
              </ul>
            ) : (
              <div className="empty">
                <Logo size={44} />
                <p className="empty-title">No forgotten tabs</p>
                <p className="empty-text">Tabs you leave open without coming back for an hour will show up here.</p>
              </div>
            )}
          </>
        )}
      </main>

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-card">
            <Logo size={40} />
            <p className="drop-title">Drop to add to your to-do list</p>
            <p className="drop-text">If the page is open in a tab, the tab will be closed.</p>
          </div>
        </div>
      )}

      {notice && !undo && (
        <div className="toast" role="status">
          <span>{notice}</span>
        </div>
      )}

      {undo && (
        <div className="toast" role="status">
          <span>Done: {undo.label}</span>
          <button
            onClick={() => {
              void send({ type: 'action', action: 'restore', key: undo.key });
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
    </>
  );
}

function TopBar({ children }: { children: React.ReactNode }) {
  return <header className="topbar">{children}</header>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <ul className="list">{children}</ul>
    </section>
  );
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="section">
      <button className={`section-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronIcon width={14} height={14} /> {title}
      </button>
      {open && <ul className="list quiet">{children}</ul>}
    </section>
  );
}

function Favicon({ task }: { task: Task }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="fav fav-emoji">{RULE_ICONS[task.rule]}</span>;
  return <img className="fav" src={favicon(task.url)} alt="" onError={() => setFailed(true)} />;
}

function Row({ task: t, now, completing, onComplete }: { task: Task; now: number; completing: Set<string>; onComplete: (t: Task) => void }) {
  const isCompleting = completing.has(t.key);
  const sub = t.rule === 'new_messages' && t.meta.account ? `${t.note} · ${t.meta.account}` : `${t.note} · ${t.domain}`;
  const when = t.status === 'snoozed' && t.snoozeUntil ? clockTime(t.snoozeUntil) : ago(t.leftAt, now);

  return (
    <li className={`row ${isCompleting ? 'completing' : ''}`}>
      <button
        className={`check ${isCompleting ? 'checked' : ''}`}
        aria-label={t.rule === 'new_messages' ? 'Mark as read' : 'Mark done'}
        title={t.rule === 'new_messages' ? 'Mark as read' : 'Mark done'}
        onClick={() => !isCompleting && onComplete(t)}
      >
        <CheckIcon width={12} height={12} />
      </button>
      <button className="row-main" onClick={() => send({ type: 'action', action: 'resume', key: t.key })} title={`Go to ${t.domain}`}>
        <Favicon task={t} />
        <span className="txt">
          <span className="title">{t.label}</span>
          <span className="sub">{sub}</span>
        </span>
      </button>
      <span className="when">{when}</span>
      <span className="row-actions">
        {t.status !== 'snoozed' && (
          <button className="mini-btn" title="Remind me in 1 hour" aria-label="Snooze 1 hour" onClick={() => send({ type: 'action', action: 'snooze', key: t.key })}>
            <ClockIcon width={15} height={15} />
          </button>
        )}
        <button className="mini-btn" title="Not needed" aria-label="Remove" onClick={() => send({ type: 'action', action: 'dismiss', key: t.key })}>
          <XIcon width={15} height={15} />
        </button>
      </span>
    </li>
  );
}

/** A live Chrome tab (Open tabs view) — not a to-do, so no "mark done" circle. */
function OpenTabRow({ tab: t, now }: { tab: chrome.tabs.Tab; now: number }) {
  const go = () => {
    void chrome.tabs.update(t.id!, { active: true });
    void chrome.windows.update(t.windowId, { focused: true });
  };
  const host = new URL(t.url!).hostname.replace(/^www\./, '');
  return (
    <li className="row no-check">
      <button className="row-main" onClick={go} title={`Go to ${host}`}>
        <img className="fav" src={favicon(t.url!)} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
        <span className="txt">
          <span className="title">{t.title || t.url}</span>
          <span className="sub">{host}</span>
        </span>
      </button>
      <span className="when">{t.lastAccessed ? ago(t.lastAccessed, now) : ''}</span>
      <span className="row-actions">
        <button
          className="mini-btn"
          title="Move to my to-do list (closes the tab)"
          aria-label="Move to to-do list"
          onClick={() => send({ type: 'saveTabs', tabIds: [t.id!], close: true })}
        >
          <PlusIcon width={15} height={15} />
        </button>
        <button className="mini-btn" title="Close tab" aria-label="Close tab" onClick={() => void chrome.tabs.remove(t.id!)}>
          <XIcon width={15} height={15} />
        </button>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tab picker: choose open tabs to add to the list
// ---------------------------------------------------------------------------

function AddView({ state, onBack }: { state: State; onBack: () => void }) {
  const { tabs, currentTabId } = useOpenTabs();
  const savedUrls = useSavedUrls(state);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  // On by default: the point is usually to get the tabs out of the way. Remembered per browser.
  const [closeAfter, setCloseAfterState] = useState(() => readFlag(CLOSE_AFTER_KEY, true));
  const setCloseAfter = (v: boolean) => {
    setCloseAfterState(v);
    writeFlag(CLOSE_AFTER_KEY, v);
  };
  const q = query.trim().toLowerCase();
  const shown = q ? tabs.filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(q)) : tabs;
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const add = async () => {
    await send({ type: 'saveTabs', tabIds: [...selected], close: closeAfter });
    onBack();
  };

  return (
    <>
      <TopBar>
        <div className="brand">
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
          <span>Add tabs to your to-do list</span>
        </div>
      </TopBar>

      <main className="content picker">
        <label className="search">
          <SearchIcon width={16} height={16} />
          <input autoFocus placeholder="Search open tabs" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>

        {shown.length === 0 ? (
          <p className="hint center">{q ? 'No open tabs match.' : 'No web pages are open.'}</p>
        ) : (
          <ul className="list">
            {shown.map((t) => {
              const already = savedUrls.has(normalizeUrl(t.url!));
              const on = selected.has(t.id!);
              return (
                <li key={t.id} className={`row pick ${on ? 'picked' : ''} ${already ? 'is-saved' : ''}`}>
                  <button className="row-main" disabled={already} onClick={() => toggle(t.id!)} aria-pressed={on}>
                    <span className={`check ${on || already ? 'checked' : ''}`} aria-hidden>
                      <CheckIcon width={12} height={12} />
                    </span>
                    <img className="fav" src={favicon(t.url!)} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <span className="txt">
                      <span className="title">{t.title || t.url}</span>
                      <span className="sub">{new URL(t.url!).hostname.replace(/^www\./, '')}</span>
                    </span>
                  </button>
                  {already ? <span className="pill">On list</span> : t.id === currentTabId ? <span className="pill soft">This tab</span> : <span />}
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <footer className="picker-bar">
        <Toggle checked={closeAfter} onChange={setCloseAfter} label="Close these tabs after adding" />
        <button className="btn-primary wide" disabled={!selected.size} onClick={add}>
          {selected.size ? `Add ${plural(selected.size, 'tab')}` : 'Pick tabs to add'}
        </button>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsView({ state, prefs, access, onBack }: { state: State; prefs: Prefs; access: Access; onBack: () => void }) {
  const [blocklist, setBlocklist] = useState(prefs.blocklist.join('\n'));
  useEffect(() => setBlocklist(prefs.blocklist.join('\n')), [prefs.blocklist]);

  const set = (p: Partial<Prefs>) => send({ type: 'setPrefs', prefs: p });
  const hour = (v: string) => (v === '' ? null : Number(v));

  return (
    <>
      <TopBar>
        <div className="brand">
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
          <span>Settings</span>
        </div>
      </TopBar>

      <main className="content settings">
        <section className="card local-only">
          <ShieldIcon width={20} height={20} />
          <div>
            <h3>Runs only on this computer</h3>
            <p className="hint">No servers, no accounts, no network requests. Your list is stored in Chrome on this device and nowhere else.</p>
          </div>
        </section>

        <section className="card">
          <h3>Page detection</h3>
          <p className="hint">
            {access.granted
              ? 'On. Tab Resume notices unfinished forms, drafts and reading — without reading what you type.'
              : 'Off. Open tabs and new messages still show up; unfinished forms, drafts and reading need access to sites.'}
          </p>
          {access.granted ? (
            <button className="btn-soft" onClick={access.revoke}>
              Turn off and remove site access
            </button>
          ) : (
            <button className="btn-primary" onClick={access.request}>
              Turn on
            </button>
          )}
        </section>

        <section className="card">
          <h3>Reminders</h3>
          <Toggle checked={prefs.nudgesEnabled} onChange={(v) => set({ nudgesEnabled: v })} label="Remind me about things I left behind" />
          <Toggle checked={prefs.inPageToast} onChange={(v) => set({ inPageToast: v })} label="Show reminders inside the page instead of system notifications" />
          <div className="field-row">
            <label>
              Quiet from
              <select value={prefs.quietStart ?? ''} onChange={(e) => set({ quietStart: hour(e.target.value) })}>
                <HourOptions />
              </select>
            </label>
            <label>
              until
              <select value={prefs.quietEnd ?? ''} onChange={(e) => set({ quietEnd: hour(e.target.value) })}>
                <HourOptions />
              </select>
            </label>
          </div>
          <button className="btn-soft" onClick={() => send({ type: 'testNudge' })}>
            Send a test reminder
          </button>
        </section>

        <section className="card">
          <h3>Messages &amp; email</h3>
          <Toggle
            checked={prefs.watchMessages}
            onChange={(v) => set({ watchMessages: v })}
            label="Show new messages and emails from open Teams, Slack, WhatsApp, Gmail, Outlook tabs"
          />
          <p className="hint">Uses only the unread number in the tab's title — never the messages themselves.</p>
        </section>

        <section className="card">
          <h3>Privacy</h3>
          <label>
            Never track these sites
            <textarea
              rows={6}
              value={blocklist}
              onChange={(e) => setBlocklist(e.target.value)}
              onBlur={() => set({ blocklist: blocklist.split('\n').map((l) => l.trim()).filter(Boolean) })}
            />
          </label>
          <p className="hint">One per line: a site (chase.com) or a word to match in site names (bank).</p>
          <button
            className="btn-soft danger"
            onClick={() => {
              if (confirm('Delete everything Tab Resume has stored?')) void send({ type: 'clearAll' });
            }}
          >
            Clear all data
          </button>
        </section>

        <DebugView state={state} />
      </main>
    </>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

function HourOptions() {
  return (
    <>
      <option value="">Off</option>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}
        </option>
      ))}
    </>
  );
}

/** Raw signals, for tuning the rules. Hidden by default. */
function DebugView({ state }: { state: State }) {
  const [open, setOpen] = useState(false);
  const visits = useMemo(
    () => Object.values(state.visits).sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 30),
    [state.visits],
  );
  return (
    <section className="card">
      <button className={`section-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronIcon width={14} height={14} /> Debug: what the sensor sees
      </button>
      {open && (
        <ul className="debug">
          {visits.map((v) => {
            const s = v.signals;
            const flags = [
              v.pageType,
              `${v.activeSec}s`,
              s.fieldsTotal ? `form ${s.fieldsFilled}/${s.fieldsTotal}` : '',
              s.draft !== 'none' ? `${s.draft} draft` : '',
              s.scrollMax ? `scroll ${s.scrollMax}%` : '',
              s.videoDuration ? `video ${s.videoPct}%` : '',
              s.submitted ? 'submitted' : '',
              s.completed ? 'completed' : '',
            ].filter(Boolean);
            return (
              <li key={v.id}>
                <span className="debug-title">{v.title}</span>
                <span className="debug-flags">{flags.join(' · ')}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
