// Sample scenarios: example inputs and the exact output the panel should show.
// Run just these with `npm run samples`. Each input is what the page sensor would report.
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/background/classifier';
import { addSavedTask, isShown, merge, savedKey } from '../../src/background/lifecycle';
import { evaluate } from '../../src/background/rules';
import { onTabClosed, syncInbox } from '../../src/background/tracker';
import type { State } from '../../src/shared/types';
import { isBlocked } from '../../src/shared/url';
import { DAY, MIN, NOW, prefs, stateWith, visit } from '../helpers';

/** What "My list" shows: "<label> — <note>" for each visible item. */
function panel(s: State, now = NOW): string[] {
  merge(s, evaluate(s, now), now);
  return Object.values(s.tasks)
    .filter(isShown)
    .map((t) => `${t.label} — ${t.note}`);
}

const left = (min: number) => ({ leftAt: NOW - min * MIN, lastActiveAt: NOW - min * MIN, startedAt: NOW - min * MIN - 10 * MIN });

describe('Sample 1 — partially watched video', () => {
  const yt = (awayMin: number) =>
    visit({ url: 'https://www.youtube.com/watch?v=abc', title: 'System Design Interview – YouTube', pageType: classify('https://www.youtube.com/watch?v=abc'), activeSec: 40, signals: { videoPct: 40, videoDuration: 1800 }, ...left(awayMin) });

  it('watched 12 of 30 min, away 25 min → flagged', () => {
    expect(panel(stateWith([yt(25)]))).toEqual(['System Design Interview — Stopped partway through']);
  });
  it('same video, away only 10 min → not yet (waits 20 min)', () => {
    expect(panel(stateWith([yt(10)]))).toEqual([]);
  });
  it('watched 95% → nothing (finished)', () => {
    const v = yt(25);
    v.signals.videoPct = 95;
    expect(panel(stateWith([v]))).toEqual([]);
  });
});

describe('Sample 2 — research paper to read later', () => {
  it('saved by the user → on the list', () => {
    const s = stateWith();
    addSavedTask(s, { url: 'https://arxiv.org/pdf/1706.03762', title: 'Attention Is All You Need' }, NOW);
    expect(panel(s)).toEqual(['Attention Is All You Need — On your to-do list']);
  });
  it('web article read 40% and left → flagged automatically, no saving needed', () => {
    const v = visit({ url: 'https://distill.pub/2020/circuits/zoom-in/', title: 'Zoom In: An Introduction to Circuits', pageType: 'article', activeSec: 300, signals: { scrollMax: 40, lastHeading: 'Features' }, ...left(30) });
    expect(panel(stateWith([v]))).toEqual(['Zoom In: An Introduction to Circuits — Stopped partway through']);
  });
});

describe('Sample 3 — shopping cart left open', () => {
  const cart = (o = {}) => visit({ url: 'https://www.example-store.com/cart', title: 'Your Cart', pageType: 'cart', activeSec: 5, ...left(10), ...o });

  it('cart with items, looked 5 s, away 10 min → flagged automatically', () => {
    expect(panel(stateWith([cart()]))).toEqual(['Cart on example-store.com — Checkout not complete']);
  });
  it('cart says "Your cart is empty" → nothing', () => {
    expect(panel(stateWith([cart({ cartEmpty: true })]))).toEqual([]);
  });
  it('order confirmation seen → nothing', () => {
    expect(panel(stateWith([cart({ signals: { completed: true } })]))).toEqual([]);
  });
});

describe('Sample 4 — a saved tab is closed', () => {
  it('stays on the list after the tab closes, and after 30 days', () => {
    const s = stateWith();
    const url = 'https://leetcode.com/problems/two-sum/';
    addSavedTask(s, { url, title: 'Two Sum - LeetCode', tabId: 7 }, NOW);
    onTabClosed(s, 7);
    expect(panel(s)).toEqual(['Two Sum — On your to-do list']);
    expect(panel(s, NOW + 30 * DAY)).toEqual(['Two Sum — On your to-do list']);
    expect(s.tasks[savedKey(url)].url).toBe(url); // clicking it reopens this URL
  });
  it('saving the same page twice keeps one item', () => {
    const s = stateWith();
    addSavedTask(s, { url: 'https://leetcode.com/problems/two-sum/', title: 'Two Sum - LeetCode' }, NOW);
    addSavedTask(s, { url: 'https://leetcode.com/problems/two-sum/?utm_source=x', title: 'Two Sum - LeetCode' }, NOW);
    expect(panel(s)).toHaveLength(1);
  });
});

describe('Sample 5 — regular tabs with no unfinished work', () => {
  it.each([
    ['Wikipedia read to the end', visit({ url: 'https://en.wikipedia.org/wiki/Chrome', title: 'Google Chrome - Wikipedia', pageType: 'article', activeSec: 300, signals: { scrollMax: 97 }, ...left(60) })],
    ['Google search results', visit({ url: 'https://www.google.com/search?q=chrome+extensions', title: 'chrome extensions - Google Search', pageType: 'search', activeSec: 60, ...left(60) })],
    ['Scrolling X', visit({ url: 'https://x.com/home', title: 'Home / X', pageType: 'feed', activeSec: 900, signals: { scrollMax: 60 }, ...left(60) })],
    ['Homepage glanced at', visit({ url: 'https://www.bbc.com/', title: 'BBC Home', pageType: 'other', activeSec: 20, signals: { scrollMax: 30 }, ...left(60) })],
    ['Login page with username typed', visit({ url: 'https://github.com/login', title: 'Sign in to GitHub', pageType: 'auth', activeSec: 20, signals: { fieldsFilled: 2 }, ...left(60) })],
  ])('%s → nothing on My list', (_, v) => {
    expect(panel(stateWith([v]))).toEqual([]);
  });
});

describe('More samples', () => {
  it('half-filled job application, tab closed → flagged', () => {
    const v = visit({ url: 'https://jobs.lever.co/acme/123/apply', title: 'Acme - Software Engineer Intern', pageType: 'form', activeSec: 240, closed: true, signals: { fieldsFilled: 4, fieldsTotal: 9 }, ...left(1) });
    expect(panel(stateWith([v]))).toEqual(['Acme — Form not complete']);
  });
  it('application submitted → nothing', () => {
    const v = visit({ url: 'https://jobs.lever.co/acme/123/apply', title: 'Acme', pageType: 'form', activeSec: 400, signals: { fieldsFilled: 9, submitted: true }, ...left(10) });
    expect(panel(stateWith([v]))).toEqual([]);
  });
  it('typed a Teams reply, did not send, away 3 min → flagged', () => {
    const v = visit({ url: 'https://teams.microsoft.com/v2/', title: 'Chat | Microsoft Teams', activeSec: 20, signals: { draft: 'short' }, ...left(3) });
    expect(panel(stateWith([v]))).toEqual(['Message in Microsoft Teams — Message not sent']);
  });
  it('one new Gmail email, inbox open in 2 tabs → one item', () => {
    const s = stateWith([], { focusedTabId: null });
    const gmail = 'https://mail.google.com/mail/u/0/#inbox';
    const tabs = (n: number) => [1, 2].map((id) => ({ id, url: gmail, title: `Inbox (${n}) - me@gmail.com - Gmail` }) as chrome.tabs.Tab);
    syncInbox(s, tabs(3), true, NOW - 10 * MIN);
    syncInbox(s, tabs(4), true, NOW);
    expect(panel(s)).toEqual(['Gmail — New emails']);
  });
  it('Gmail with 2,000 old unread and nothing new → nothing', () => {
    const s = stateWith([], { focusedTabId: null });
    const tab = [{ id: 1, url: 'https://mail.google.com/mail/u/0/', title: 'Inbox (2,000) - me@gmail.com - Gmail' } as chrome.tabs.Tab];
    syncInbox(s, tab, true, NOW - 10 * MIN);
    syncInbox(s, tab, true, NOW);
    expect(panel(s)).toEqual([]);
  });
  it('bank site → never watched', () => {
    expect(isBlocked('https://secure.chase.com/payments', prefs().blocklist)).toBe(true);
  });
});
