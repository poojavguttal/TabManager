import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPageReport, ensureVisit, markInboxSeen, onTabClosed, syncInbox } from '../../src/background/tracker';
import type { PageMessage } from '../../src/shared/types';
import { NOW, inbox, prefs, signals, stateWith } from '../helpers';

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

const tab = (id: number, url: string, title: string) => ({ id, url, title }) as chrome.tabs.Tab;
const page = (url: string, o: Partial<PageMessage> = {}): PageMessage => ({ type: 'page', url, title: 'T', activeSec: 10, signals: signals(), ...o });

describe('ensureVisit', () => {
  it('ignores non-web and blocked pages', () => {
    const s = stateWith();
    expect(ensureVisit(s, prefs(), 1, 'chrome://newtab')).toBeNull();
    expect(ensureVisit(s, prefs(), 1, 'https://www.chase.com/')).toBeNull();
  });
  it('reuses the visit for the same page and starts a new one on navigation', () => {
    const s = stateWith();
    const a = ensureVisit(s, prefs(), 1, 'https://a.com/x#one')!;
    expect(ensureVisit(s, prefs(), 1, 'https://a.com/x#two')).toBe(a);
    const b = ensureVisit(s, prefs(), 1, 'https://a.com/y')!;
    expect(b.prevVisitId).toBe(a.id);
    expect(a.leftAt).toBe(NOW);
  });
  it('submit then navigate = the form went through', () => {
    const s = stateWith();
    const a = ensureVisit(s, prefs(), 1, 'https://a.com/apply')!;
    a.signals.submitted = true;
    ensureVisit(s, prefs(), 1, 'https://a.com/next');
    expect(a.signals.completed).toBe(true);
  });
});

describe('applyPageReport', () => {
  it('adds active time as a delta and survives a reload resetting the counter', () => {
    const s = stateWith();
    applyPageReport(s, prefs(), 1, page('https://a.com/x', { activeSec: 10 }));
    applyPageReport(s, prefs(), 1, page('https://a.com/x', { activeSec: 25 }));
    applyPageReport(s, prefs(), 1, page('https://a.com/x', { activeSec: 4 }));
    expect(Object.values(s.visits)[0].activeSec).toBe(29);
  });
  it('keeps the furthest scroll and a sticky submitted flag', () => {
    const s = stateWith();
    applyPageReport(s, prefs(), 1, page('https://a.com/x', { signals: signals({ scrollMax: 60, submitted: true }) }));
    applyPageReport(s, prefs(), 1, page('https://a.com/x', { signals: signals({ scrollMax: 20 }) }));
    const v = Object.values(s.visits)[0];
    expect(v.signals.scrollMax).toBe(60);
    expect(v.signals.submitted).toBe(true);
  });
  it('a real confirmation page completes the form you came from on the same site only', () => {
    const s = stateWith();
    applyPageReport(s, prefs(), 1, page('https://a.com/apply'));
    applyPageReport(s, prefs(), 1, page('https://a.com/thanks', { signals: signals({ completed: true }) }));
    const [form] = Object.values(s.visits);
    expect(form.signals.completed).toBe(true);

    const s2 = stateWith();
    applyPageReport(s2, prefs(), 1, page('https://a.com/apply'));
    applyPageReport(s2, prefs(), 1, page('https://b.com/thanks', { signals: signals({ completed: true }) }));
    expect(Object.values(s2.visits)[0].signals.completed).toBe(false);
  });
});

describe('onTabClosed', () => {
  it('closes the visit and forgets the tab', () => {
    const s = stateWith();
    const v = ensureVisit(s, prefs(), 3, 'https://a.com/x')!;
    s.focusedTabId = 3;
    onTabClosed(s, 3);
    expect(v.closed).toBe(true);
    expect(s.tabVisit[3]).toBeUndefined();
    expect(s.focusedTabId).toBeNull();
  });
});

describe('syncInbox', () => {
  const gmail = 'https://mail.google.com/mail/u/0/#inbox';

  it('the first count seen is the baseline, so old unread mail is not "new"', () => {
    const s = stateWith();
    syncInbox(s, [tab(1, gmail, 'Inbox (2,000) - me@gmail.com - Gmail')], true, NOW);
    expect(s.inbox[1]).toMatchObject({ count: 2000, seen: 2000, newSince: undefined });
  });
  it('a higher count later is new', () => {
    const s = stateWith();
    syncInbox(s, [tab(1, gmail, 'Inbox (2) - me@gmail.com - Gmail')], true, NOW);
    syncInbox(s, [tab(1, gmail, 'Inbox (4) - me@gmail.com - Gmail')], true, NOW + 1);
    expect(s.inbox[1]).toMatchObject({ count: 4, seen: 2, newSince: NOW + 1 });
  });
  it('email with no count in the title keeps the last count (reading a message)', () => {
    const s = stateWith();
    syncInbox(s, [tab(1, gmail, 'Inbox (2) - me@gmail.com - Gmail')], true, NOW);
    syncInbox(s, [tab(1, gmail, 'Re: Offer - me@gmail.com - Gmail')], true, NOW + 1);
    expect(s.inbox[1].count).toBe(2);
  });
  it('chat with no count in the title means nothing unread', () => {
    const s = stateWith();
    syncInbox(s, [tab(1, 'https://web.whatsapp.com/', '(3) WhatsApp')], true, NOW);
    syncInbox(s, [tab(1, 'https://web.whatsapp.com/', 'WhatsApp')], true, NOW + 1);
    expect(s.inbox[1]).toMatchObject({ count: 0, seen: 0 });
  });
  it('looking at one tab of an account counts as seen in all its tabs', () => {
    const s = stateWith([], { inbox: { 1: inbox({ tabId: 1, url: gmail, account: 'me@gmail.com', count: 2, seen: 2 }), 2: inbox({ tabId: 2, url: gmail, account: 'me@gmail.com', count: 2, seen: 2 }) } });
    Object.assign(s, { focusedTabId: 1, windowFocused: true });
    const t = 'Inbox (5) - me@gmail.com - Gmail';
    syncInbox(s, [tab(1, gmail, t), tab(2, gmail, t)], true, NOW);
    expect(s.inbox[2]).toMatchObject({ count: 5, seen: 5 });
  });
  it('turned off = nothing tracked', () => {
    const s = stateWith();
    syncInbox(s, [tab(1, gmail, 'Inbox (2) - Gmail')], false, NOW);
    expect(s.inbox).toEqual({});
  });
  it('mark as read clears the whole account', () => {
    const s = stateWith([], { inbox: { 1: inbox({ tabId: 1, url: gmail, account: 'a', count: 5, seen: 1, newSince: NOW }) } });
    markInboxSeen(s, 'gmail|a');
    expect(s.inbox[1]).toMatchObject({ seen: 5, newSince: undefined });
  });
});
