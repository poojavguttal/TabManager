import { describe, expect, it } from 'vitest';
import { shortTitle, templateLabel } from '../../src/background/labels';

describe('shortTitle', () => {
  it('drops only the trailing site name', () => {
    expect(shortTitle('Apply – ML Engineer – Acme')).toBe('Apply – ML Engineer');
  });
  it('keeps titles with no separator', () => expect(shortTitle('Checkout')).toBe('Checkout'));
  it('truncates long titles with an ellipsis', () => {
    const t = shortTitle('x'.repeat(80));
    expect(t).toHaveLength(55);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('templateLabel', () => {
  const base = { title: 'Senior Engineer Application | Acme', domain: 'acme.com', meta: {} };

  it('gives short qualitative notes, never numbers', () => {
    const rules = ['abandoned_form', 'unsent_draft', 'unfinished_checkout', 'partial_reading', 'partial_video', 'saved'] as const;
    for (const rule of rules) {
      const { note } = templateLabel({ ...base, rule, meta: { filled: 3, total: 5, scroll: 40 } });
      expect(note).not.toMatch(/\d/);
    }
  });
  it('form → title + "Form not complete"', () => {
    expect(templateLabel({ ...base, rule: 'abandoned_form' })).toEqual({ label: 'Senior Engineer Application', note: 'Form not complete' });
  });
  it('docs vs article reading notes', () => {
    expect(templateLabel({ ...base, rule: 'partial_reading', meta: { pageType: 'docs' } }).note).toBe('Setup not finished');
    expect(templateLabel({ ...base, rule: 'partial_reading', meta: { pageType: 'article' } }).note).toBe('Stopped partway through');
  });
  it('messages name the app', () => {
    expect(templateLabel({ ...base, rule: 'unsent_message', meta: { app: 'teams' } }).label).toBe('Message in Microsoft Teams');
    expect(templateLabel({ ...base, rule: 'new_messages', meta: { app: 'gmail', kind: 'email' } })).toEqual({ label: 'Gmail', note: 'New emails' });
    expect(templateLabel({ ...base, rule: 'new_messages', meta: { app: 'nope' } }).label).toBe('messaging app');
  });
});
