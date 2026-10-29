import { describe, expect, it } from 'vitest';
import { nudgesAllowed, pickNudge, type NudgeContext } from '../../src/background/nudges';
import { CONFIG } from '../../src/shared/config';
import { HOUR, MIN, NOW, prefs, stateWith, task, visit } from '../helpers';

const active: NudgeContext = { userActive: true, fullscreen: false };
const at = (h: number) => new Date(2026, 9, 29, h, 30).getTime();

describe('nudgesAllowed', () => {
  it('respects the on/off switch and pause', () => {
    expect(nudgesAllowed(prefs({ nudgesEnabled: false }), NOW)).toBe(false);
    expect(nudgesAllowed(prefs({ pausedUntil: NOW + 1 }), NOW)).toBe(false);
    expect(nudgesAllowed(prefs(), NOW)).toBe(true);
  });
  it('quiet hours, including ones that wrap past midnight', () => {
    const p = prefs({ quietStart: 22, quietEnd: 7 });
    expect(nudgesAllowed(p, at(23))).toBe(false);
    expect(nudgesAllowed(p, at(3))).toBe(false);
    expect(nudgesAllowed(p, at(12))).toBe(true);
  });
});

describe('pickNudge: reminder for a task you left', () => {
  const setup = (o = {}) => {
    const t = task({ score: 0.8, leftAt: NOW - HOUR, ...o });
    return { t, s: stateWith([], { tasks: { [t.key]: t } }) };
  };

  it('reminds about a pending task and records it', () => {
    const { t, s } = setup();
    const n = pickNudge(s, prefs(), NOW, active);
    expect(n?.title).toBe(t.label);
    expect(t.nudgeCount).toBe(1);
    expect(t.status).toBe('nudged');
    expect(s.lastNudgeAt).toBe(NOW);
  });
  it('waits at least 20 min between any two reminders', () => {
    const { s } = setup();
    s.lastNudgeAt = NOW - (CONFIG.nudge.globalGapMin - 1) * MIN;
    expect(pickNudge(s, prefs(), NOW, active)).toBeNull();
  });
  it('waits 60 min before reminding about the same task', () => {
    const { s } = setup({ lastNudgedAt: NOW - 30 * MIN, nudgeCount: 1, status: 'nudged' });
    expect(pickNudge(s, prefs(), NOW, active)).toBeNull();
  });
  it('stops after 3 reminders for one task', () => {
    const { s } = setup({ nudgeCount: CONFIG.nudge.maxPerTask });
    expect(pickNudge(s, prefs(), NOW, active)).toBeNull();
  });
  it('stays quiet while idle, fullscreen, or typing', () => {
    expect(pickNudge(setup().s, prefs(), NOW, { userActive: false, fullscreen: false })).toBeNull();
    expect(pickNudge(setup().s, prefs(), NOW, { userActive: true, fullscreen: true })).toBeNull();
    const { s } = setup();
    s.lastKeyAt = NOW - 1000;
    expect(pickNudge(s, prefs(), NOW, active)).toBeNull();
  });
  it('skips weak tasks and the tab you are on', () => {
    expect(pickNudge(setup({ score: CONFIG.nudgeThreshold - 0.01 }).s, prefs(), NOW, active)).toBeNull();
    const { s } = setup({ tabId: 7 });
    Object.assign(s, { focusedTabId: 7, windowFocused: true });
    expect(pickNudge(s, prefs(), NOW, active)).toBeNull();
  });
});

describe('pickNudge: closing and welcome back', () => {
  it('closing a tab with unfinished work offers to reopen', () => {
    const v = visit({ tabId: 42, closed: true });
    const t = task({ visitIds: [v.id] });
    const s = stateWith([v], { tasks: { [t.key]: t } });
    const n = pickNudge(s, prefs(), NOW, { ...active, closedTabId: 42 });
    expect(n?.title).toBe(`Saved for later: ${t.label}`);
    expect(n?.ref.actions).toEqual(['resume', 'dismiss']);
  });
  it('welcome back mentions how many things are open', () => {
    const a = task({ key: 'a', score: 0.9, label: 'Top one' });
    const b = task({ key: 'b', score: 0.5 });
    const s = stateWith([], { tasks: { a, b } });
    const n = pickNudge(s, prefs(), NOW, { ...active, welcomeBack: true });
    expect(n?.message).toBe('You left 2 things open, like: Top one');
  });
  it('keeps only the 20 most recent notification records', () => {
    const s = stateWith();
    for (let i = 0; i < 25; i++) s.notifs[`n${i}`] = { kind: 'task', actions: [], at: i };
    const t = task();
    s.tasks[t.key] = t;
    pickNudge(s, prefs(), NOW, active);
    expect(Object.keys(s.notifs)).toHaveLength(20);
  });
});
