import { describe, expect, it } from 'vitest';
import { addSavedTask, isPending, isShown, merge, savedKey, setStatus } from '../../src/background/lifecycle';
import { CONFIG } from '../../src/shared/config';
import { DAY, HOUR, NOW, candidate, stateWith, task, visit } from '../helpers';

describe('merge', () => {
  it('creates an active task with a label from a strong candidate', () => {
    const s = stateWith();
    merge(s, [candidate({ title: 'Apply – Engineer – Acme' })], NOW);
    const t = Object.values(s.tasks)[0];
    expect(t.status).toBe('active');
    expect(t.label).toBe('Apply – Engineer');
    expect(t.note).toBe('Form not complete');
  });
  it('keeps weak candidates hidden', () => {
    const s = stateWith();
    merge(s, [candidate({ score: CONFIG.showThreshold - 0.01 })], NOW);
    expect(Object.values(s.tasks)[0].status).toBe('candidate');
  });
  it('does not revive finished tasks', () => {
    const t = task({ status: 'dismissed', finishedAt: NOW - HOUR });
    const s = stateWith([], { tasks: { [t.key]: t } });
    merge(s, [candidate()], NOW);
    expect(s.tasks[t.key].status).toBe('dismissed');
  });
  it('puts a resumed task back on the list when you leave it again', () => {
    const t = task({ status: 'resumed', resumedAt: NOW - 2 * HOUR });
    const s = stateWith([], { tasks: { [t.key]: t } });
    merge(s, [candidate({ leftAt: NOW - HOUR })], NOW);
    expect(s.tasks[t.key].status).toBe('active');
  });
  it('wakes snoozed tasks when the snooze ends', () => {
    const t = task({ status: 'snoozed', snoozeUntil: NOW - 1 });
    const s = stateWith([], { tasks: { [t.key]: t } });
    merge(s, [candidate()], NOW);
    expect(s.tasks[t.key].status).toBe('active');
  });
  it('marks a task done when its page shows it was completed', () => {
    const v = visit({ signals: { submitted: true } });
    const t = task({ visitIds: [v.id] });
    const s = stateWith([v], { tasks: { [t.key]: t } });
    merge(s, [], NOW);
    expect(s.tasks[t.key].status).toBe('done');
  });
  it('expires stale suggestions after a week', () => {
    const t = task({ leftAt: NOW - (CONFIG.taskExpireDays + 1) * DAY });
    const s = stateWith([], { tasks: { [t.key]: t } });
    merge(s, [], NOW);
    expect(s.tasks[t.key].status).toBe('expired');
  });
  it('removes new-message cards once nothing is new', () => {
    const t = task({ key: 'new_messages|gmail|', rule: 'new_messages' });
    const s = stateWith([], { tasks: { [t.key]: t } });
    merge(s, [], NOW);
    expect(s.tasks[t.key]).toBeUndefined();
  });
  it('removes tasks from rules that no longer exist', () => {
    const t = task({ key: 'research|x', rule: 'research' as never });
    const s = stateWith([], { tasks: { [t.key]: t } });
    merge(s, [], NOW);
    expect(s.tasks[t.key]).toBeUndefined();
  });
  it('prunes finished tasks after two weeks', () => {
    const t = task({ status: 'done', finishedAt: NOW - (CONFIG.pruneFinishedDays + 1) * DAY });
    const s = stateWith([], { tasks: { [t.key]: t } });
    merge(s, [], NOW);
    expect(s.tasks[t.key]).toBeUndefined();
  });
});

describe('your to-dos', () => {
  it('adding the same page twice keeps one item', () => {
    const s = stateWith();
    addSavedTask(s, { url: 'https://a.com/x?utm_source=y', title: 'X' }, NOW);
    addSavedTask(s, { url: 'https://a.com/x', title: 'X again' }, NOW + 1);
    expect(Object.keys(s.tasks)).toEqual([savedKey('https://a.com/x')]);
    expect(s.tasks[savedKey('https://a.com/x')].title).toBe('X');
  });
  it('re-adding a finished to-do makes a fresh one', () => {
    const s = stateWith();
    addSavedTask(s, { url: 'https://a.com/x', title: 'X' }, NOW);
    setStatus(s.tasks[savedKey('https://a.com/x')], 'done', NOW);
    addSavedTask(s, { url: 'https://a.com/x', title: 'X' }, NOW + 1);
    expect(s.tasks[savedKey('https://a.com/x')].status).toBe('active');
  });
  it('to-dos are scored to get reminders', () => {
    const s = stateWith();
    addSavedTask(s, { url: 'https://a.com/x', title: 'X' }, NOW);
    expect(s.tasks[savedKey('https://a.com/x')].score).toBeGreaterThanOrEqual(CONFIG.nudgeThreshold);
  });
  it('never expire and survive merges with no candidates (e.g. after a restart)', () => {
    const s = stateWith();
    addSavedTask(s, { url: 'https://a.com/x', title: 'X' }, NOW - 60 * DAY);
    merge(s, [], NOW);
    expect(s.tasks[savedKey('https://a.com/x')].status).toBe('active');
  });
});

describe('isShown / isPending / setStatus', () => {
  it('snoozed shows but is not pending', () => {
    const t = task({ status: 'snoozed' });
    expect(isShown(t)).toBe(true);
    expect(isPending(t)).toBe(false);
  });
  it('setStatus stamps finishedAt only for finished states', () => {
    const t = task();
    setStatus(t, 'snoozed', NOW);
    expect(t.finishedAt).toBeUndefined();
    setStatus(t, 'done', NOW);
    expect(t.finishedAt).toBe(NOW);
  });
});
