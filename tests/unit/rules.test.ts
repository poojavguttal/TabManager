import { describe, expect, it } from 'vitest';
import { engagement, evaluate, recency } from '../../src/background/rules';
import { CONFIG } from '../../src/shared/config';
import { DAY, HOUR, MIN, NOW, inbox, stateWith, visit } from '../helpers';

const rulesOf = (s: ReturnType<typeof stateWith>) => evaluate(s, NOW).map((c) => c.rule);

describe('engagement', () => {
  it('has a floor and caps at 1', () => {
    expect(engagement(0)).toBe(CONFIG.engagementFloor);
    expect(engagement(CONFIG.engagementFullSec / 2)).toBe(0.5);
    expect(engagement(10_000)).toBe(1);
  });
});

describe('recency', () => {
  it('is full for a day, then decays to the floor at a week', () => {
    expect(recency(NOW - 23 * HOUR, NOW)).toBe(1);
    expect(recency(NOW - 7 * DAY, NOW)).toBeCloseTo(CONFIG.recency.floor);
    expect(recency(NOW - 30 * DAY, NOW)).toBeCloseTo(CONFIG.recency.floor);
    const mid = recency(NOW - 4 * DAY, NOW);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(CONFIG.recency.floor);
  });
});

describe('evaluate: forms, drafts, checkout', () => {
  it('flags a half-filled form you left', () => {
    const s = stateWith([visit({ pageType: 'form', signals: { fieldsFilled: 3, fieldsTotal: 8 } })]);
    const [c] = evaluate(s, NOW);
    expect(c.rule).toBe('abandoned_form');
    expect(c.score).toBeGreaterThanOrEqual(CONFIG.showThreshold);
    expect(c.key).toBe('abandoned_form|https://example.com/page');
  });
  it('ignores a submitted form, too few fields, and leaving only a moment ago', () => {
    expect(rulesOf(stateWith([visit({ signals: { fieldsFilled: 3, submitted: true } })]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ signals: { fieldsFilled: 1 } })]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ leftAt: NOW - 30_000, signals: { fieldsFilled: 3 } })]))).toEqual([]);
  });
  it('closing the tab counts as away long enough', () => {
    expect(rulesOf(stateWith([visit({ closed: true, leftAt: NOW - 1000, signals: { fieldsFilled: 3 } })]))).toEqual(['abandoned_form']);
  });
  it('skips the tab you are looking at', () => {
    const v = visit({ leftAt: undefined, signals: { fieldsFilled: 3 } });
    expect(rulesOf(stateWith([v], { focusedTabId: v.tabId, windowFocused: true }))).toEqual([]);
  });
  it('skips completed visits and ignored page types', () => {
    expect(rulesOf(stateWith([visit({ signals: { fieldsFilled: 3, completed: true } })]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ pageType: 'auth', signals: { fieldsFilled: 3 } })]))).toEqual([]);
  });
  it('long drafts count; autosaving editors do not', () => {
    expect(rulesOf(stateWith([visit({ signals: { draft: 'long' } })]))).toEqual(['unsent_draft']);
    expect(rulesOf(stateWith([visit({ url: 'https://docs.google.com/document/d/1', signals: { draft: 'long' } })]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ signals: { draft: 'short' } })]))).toEqual([]);
  });
  it('Google Forms count even though docs.google.com autosaves', () => {
    const v = visit({ url: 'https://docs.google.com/forms/d/e/1/viewform', pageType: 'form', signals: { fieldsFilled: 3 } });
    expect(rulesOf(stateWith([v]))).toEqual(['abandoned_form']);
  });
  it('anything left in a cart shows, however briefly you looked', () => {
    const [c] = evaluate(stateWith([visit({ url: 'https://shop.com/cart', pageType: 'cart', activeSec: 5 })]), NOW);
    expect(c.rule).toBe('unfinished_checkout');
    expect(c.score).toBeGreaterThanOrEqual(CONFIG.nudgeThreshold);
  });
  it('an empty cart, a finished order, or leaving a moment ago does not show', () => {
    const empty = visit({ url: 'https://shop.com/cart', pageType: 'cart', features: { cartEmpty: true } as never });
    expect(rulesOf(stateWith([empty]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ pageType: 'cart', signals: { completed: true } })]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ pageType: 'cart', leftAt: NOW - 30_000 })]))).toEqual([]);
  });
  it('checkout wins over form on a cart page (one per visit)', () => {
    expect(rulesOf(stateWith([visit({ pageType: 'cart', signals: { fieldsFilled: 4 } })]))).toEqual(['unfinished_checkout']);
  });
});

describe('evaluate: reading and video', () => {
  it('flags an article read partway', () => {
    const s = stateWith([visit({ pageType: 'article', activeSec: 90, signals: { scrollMax: 40, lastHeading: 'Setup' } })]);
    const [c] = evaluate(s, NOW);
    expect(c.rule).toBe('partial_reading');
    expect(c.lastHeading).toBe('Setup');
  });
  it('ignores barely-started and almost-finished reading', () => {
    expect(rulesOf(stateWith([visit({ pageType: 'article', activeSec: 90, signals: { scrollMax: 5 } })]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ pageType: 'article', activeSec: 90, signals: { scrollMax: 95 } })]))).toEqual([]);
  });
  it('a half-watched video shows after 20 min away, not before', () => {
    const sig = { videoPct: 40, videoDuration: 1200 };
    expect(rulesOf(stateWith([visit({ pageType: 'video', leftAt: NOW - 10 * MIN, signals: sig })]))).toEqual([]);
    expect(rulesOf(stateWith([visit({ pageType: 'video', leftAt: NOW - 25 * MIN, signals: sig })]))).toEqual(['partial_video']);
  });
  it('scores video on watch time, so little active time still shows', () => {
    const s = stateWith([visit({ pageType: 'video', activeSec: 30, signals: { videoPct: 40, videoDuration: 1200 } })]);
    expect(evaluate(s, NOW)[0].score).toBeGreaterThanOrEqual(CONFIG.showThreshold);
  });
});

describe('evaluate: messaging apps', () => {
  it('a typed, unsent chat message is flagged, even a short one', () => {
    const v = visit({ url: 'https://teams.microsoft.com/v2/', leftAt: NOW - 2 * MIN, activeSec: 5, signals: { draft: 'short' } });
    const [c] = evaluate(stateWith([v]), NOW);
    expect(c.rule).toBe('unsent_message');
    expect(c.meta.app).toBe('teams');
  });
  it('messaging apps never produce reading/form tasks', () => {
    const v = visit({ url: 'https://web.whatsapp.com/', pageType: 'article', activeSec: 600, signals: { scrollMax: 50, fieldsFilled: 3 } });
    expect(rulesOf(stateWith([v]))).toEqual([]);
  });
  it('new messages: one card per app + account across tabs', () => {
    const s = stateWith([], {
      inbox: {
        1: inbox({ tabId: 1, url: 'https://mail.google.com/mail/u/0/', account: 'me@gmail.com', count: 5, seen: 3 }),
        2: inbox({ tabId: 2, url: 'https://mail.google.com/mail/u/0/', account: 'me@gmail.com', count: 5, seen: 3 }),
        3: inbox({ tabId: 3, url: 'https://mail.google.com/mail/u/1/', account: 'work@acme.com', count: 2, seen: 2 }),
      },
    });
    const cs = evaluate(s, NOW);
    expect(cs.map((c) => c.key)).toEqual(['new_messages|gmail|me@gmail.com']);
  });
});

describe('evaluate: suppression', () => {
  it('stops suggesting a rule on a site after repeated dismissals', () => {
    const s = stateWith([visit({ signals: { fieldsFilled: 3 } })], {
      suppressed: { 'example.com|abandoned_form': CONFIG.suppressAfterDismissals },
    });
    expect(rulesOf(s)).toEqual([]);
  });
});
